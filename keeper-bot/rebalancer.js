import { ethers } from "ethers";
import { provider, signer } from "./provider.js";
import {
  MAX_GAS_PRICE,
  MAX_GAS_GWEI,
  POLL_INTERVAL_MS,
  RebalancerVaultABI,
  IDLE_DEPLOY_THRESHOLD_BPS,
} from "./config.js";
import { vaultState, networkState } from "./state.js";
import { withNonce } from "./nonceManager.js";
import { isNetworkError, isRetryableError, jitter } from "./errors.js";
import { logInfo, logWarn, logErr } from "./logger.js";

const VAULT_LENS_ABI = [
  "function isOutOfRange(address vault) view returns (bool)",
  "function computeRebalanceParams(address vault) view returns (bool swapZeroForOne, uint256 swapAmount)",
  "function computeDeployIdleParams(address vault) view returns (bool swapZeroForOne, uint256 swapAmount)",
  "function getPoolState(address vault) view returns (uint160 sqrtPriceX96, int24 tick)",
];

const ERC20_ABI = ["function balanceOf(address account) view returns (uint256)"];

const Q96 = 1n << 96n;
const BPS_DENOMINATOR = 10_000n;

/// Mirror of VaultMath.token1ToToken0: value `amount1` of token1 in token0 units
/// at the given sqrt price. Uses floor division to match the on-chain mulDiv.
function token1ToToken0(amount1, sqrtPriceX96) {
  const sqrtPrice = BigInt(sqrtPriceX96);
  if (sqrtPrice === 0n) throw new Error("invalid pool price (sqrtPriceX96=0)");
  return (((amount1 * Q96) / sqrtPrice) * Q96) / sqrtPrice;
}

/// Best-effort human-readable revert reason from an ethers error.
function decodeRevert(err) {
  if (err?.revert?.name) {
    const args = err.revert.args?.length ? `(${err.revert.args.join(", ")})` : "";
    return `${err.revert.name}${args}`;
  }
  if (err?.reason) return err.reason;
  const data = err?.data ?? err?.info?.error?.data;
  if (data === "0x" || data == null) return "no revert data";
  return err?.shortMessage ?? String(err?.message ?? err);
}

async function computeRebalanceArgs(lensAddr, vaultAddr) {
  const lens = new ethers.Contract(lensAddr, VAULT_LENS_ABI, provider);
  const [swapZeroForOne, swapAmount] = await lens.computeRebalanceParams(vaultAddr);
  return [swapZeroForOne, swapAmount];
}

/// Resolve current gas price, returning null (and logging) when it exceeds the cap.
async function resolveGasPrice(label) {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? MAX_GAS_PRICE;
  if (gasPrice > MAX_GAS_PRICE) {
    logWarn(
      label,
      `gas too high (${ethers.formatUnits(gasPrice, "gwei")} gwei > ${MAX_GAS_GWEI}) — skipping`,
    );
    return null;
  }
  return gasPrice;
}

/// Idle value (token0 + token1 valued in token0) as a fraction of totalAssets, in bps.
async function computeIdleBps(vault, lens, vaultAddr) {
  const [totalAssets, t0, t1, poolState] = await Promise.all([
    vault.totalAssets(),
    vault.token0(),
    vault.token1(),
    lens.getPoolState(vaultAddr),
  ]);
  if (totalAssets === 0n) return { idleBps: 0n, totalAssets };

  const token0 = new ethers.Contract(t0, ERC20_ABI, provider);
  const token1 = new ethers.Contract(t1, ERC20_ABI, provider);
  const [idle0, idle1] = await Promise.all([
    token0.balanceOf(vaultAddr),
    token1.balanceOf(vaultAddr),
  ]);

  const idleValue0 = idle0 + token1ToToken0(idle1, poolState[0]);
  const idleBps = (idleValue0 * BPS_DENOMINATOR) / totalAssets;
  return { idleBps, idleValue0, totalAssets };
}

/// When the position is in range, compound idle balances into it once idle value
/// exceeds IDLE_DEPLOY_THRESHOLD_BPS of totalAssets.
async function checkAndDeployIdle(watched, vault, lens, vs) {
  const { idleBps, idleValue0, totalAssets } = await computeIdleBps(
    vault,
    lens,
    watched.vault,
  );
  logInfo(
    watched.label,
    `idle=${idleValue0 ?? 0n} / totalAssets=${totalAssets} (${idleBps} bps)`,
  );
  if (idleBps < IDLE_DEPLOY_THRESHOLD_BPS) return;

  if (await vault.paused()) {
    logInfo(watched.label, "paused — deployIdle skipped");
    return;
  }

  const gasPrice = await resolveGasPrice(watched.label);
  if (gasPrice === null) return;

  // Balancing swap params come exclusively from the vault lens — no fallback.
  const [swapZeroForOne, swapAmount] = await lens.computeDeployIdleParams(
    watched.vault,
  );

  // Preflight the exact call before broadcasting. If it would revert (e.g. the
  // pool's mint bound "PSC" when slippageBps is too tight), skip this cycle
  // rather than waste gas or trip the failure backoff.
  const vaultAsSigner = vault.connect(signer);
  try {
    await vaultAsSigner.deployIdle.staticCall(swapZeroForOne, swapAmount);
  } catch (err) {
    logWarn(
      watched.label,
      `deployIdle would revert — skipping (${decodeRevert(err)})`,
    );
    return;
  }

  logInfo(
    watched.label,
    `IDLE ${idleBps} bps ≥ ${IDLE_DEPLOY_THRESHOLD_BPS} bps — deploying idle ` +
      `(zeroForOne=${swapZeroForOne} amount=${swapAmount})`,
  );

  const receipt = await buildAndSendTx(
    vaultAsSigner,
    "deployIdle",
    [swapZeroForOne, swapAmount],
    gasPrice,
    watched.label,
  );
  if (receipt?.status !== 1) throw new Error("deployIdle tx reverted");

  const gasFee = receipt.gasUsed * receipt.gasPrice;
  vs.totalIdleDeploys += 1;
  vs.lastIdleDeployAt = Date.now();
  logInfo(
    watched.label,
    `deployIdle #${vs.totalIdleDeploys} confirmed in block ${receipt.blockNumber} — ` +
      `gasUsed=${receipt.gasUsed} gasPrice=${ethers.formatUnits(receipt.gasPrice, "gwei")} gwei ` +
      `fee=${ethers.formatEther(gasFee)}`,
  );
}

// ── Core functions ─────────────────────────────────────────────────────────────

export async function buildAndSendTx(contract, method, args, gasPrice, label) {
  const txRequest = await contract[method].populateTransaction(...args);
  const gasEstimate = await provider.estimateGas({
    ...txRequest,
    from: signer.address,
  });

  // Serialize nonce assignment + submission across all vaults (shared signer).
  const response = await withNonce((nonce) =>
    signer.sendTransaction({
      ...txRequest,
      nonce,
      gasLimit: (gasEstimate * 120n) / 100n,
      gasPrice,
    }),
  );

  logInfo(label, `${method} tx sent: ${response.hash}`);
  return response.wait();
}

export async function preflight() {
  const bal = await provider.getBalance(signer.address);
  logInfo(
    "preflight",
    `keeper=${signer.address} native balance=${ethers.formatEther(bal)}`,
  );
  if (bal === 0n)
    throw new Error("Keeper has zero native balance — top up before running");
}

export async function checkAndRebalance(watched) {
  const vs = vaultState[watched.vault];
  if (Date.now() < vs.nextAttemptAt) return;

  const vault = new ethers.Contract(
    watched.vault,
    RebalancerVaultABI,
    provider,
  );

  if (!watched.lens) {
    logErr(watched.label, "LENS_ADDRESS not configured — set it in keeper-bot/.env");
    return;
  }

  const lens = new ethers.Contract(watched.lens, VAULT_LENS_ABI, provider);

  try {
    const tokenId = await vault.tokenId();
    if (tokenId === 0n) {
      logInfo(watched.label, "not initialized — skipping");
      return;
    }

    const isOutOfRange = await lens.isOutOfRange(watched.vault);
    logInfo(watched.label, `isOutOfRange=${isOutOfRange}`);
    if (!isOutOfRange) {
      // In range: no re-ranging needed, but compound idle balances if they've
      // grown past the threshold (fresh deposits, leftover dust, collected fees).
      await checkAndDeployIdle(watched, vault, lens, vs);
      vs.consecutiveFailures = 0;
      vs.nextAttemptAt = 0;
      return;
    }

    const isPaused = await vault.paused();
    if (isPaused) {
      logInfo(watched.label, "paused — rebalance skipped");
      vs.consecutiveFailures = 0;
      vs.nextAttemptAt = 0;
      return;
    }

    logInfo(
      watched.label,
      `OUT OF RANGE — triggering rebalance (strategy=${watched.strategy})`,
    );

    const gasPrice = await resolveGasPrice(watched.label);
    if (gasPrice === null) return;

    const rebalanceArgs = await computeRebalanceArgs(
      watched.lens,
      watched.vault,
    );
    logInfo(
      watched.label,
      `swap: zeroForOne=${rebalanceArgs[0]} amount=${rebalanceArgs[1]}`,
    );

    const receipt = await buildAndSendTx(
      vault.connect(signer),
      "rebalance",
      rebalanceArgs,
      gasPrice,
      watched.label,
    );

    if (receipt?.status !== 1) throw new Error("rebalance tx reverted");

    // Real gas fee actually paid = gas units consumed * effective price charged.
    const gasFee = receipt.gasUsed * receipt.gasPrice;

    vs.totalRebalances += 1;
    vs.lastRebalanceAt = Date.now();
    vs.consecutiveFailures = 0;
    vs.nextAttemptAt = 0;
    logInfo(
      watched.label,
      `rebalance #${vs.totalRebalances} confirmed in block ${receipt.blockNumber} — ` +
        `gasUsed=${receipt.gasUsed} gasPrice=${ethers.formatUnits(receipt.gasPrice, "gwei")} gwei ` +
        `fee=${ethers.formatEther(gasFee)}`,
    );
  } catch (err) {
    vs.consecutiveFailures += 1;
    const baseBackoff =
      Number(POLL_INTERVAL_MS) * 2 ** Math.min(vs.consecutiveFailures, 6);
    vs.nextAttemptAt =
      Date.now() + jitter(Math.min(baseBackoff, 5 * 60 * 1000));
    if (isNetworkError(err)) networkState.failures += 1;
    logErr(watched.label, err instanceof Error ? err.message : String(err));
    if (!isRetryableError(err))
      logErr(watched.label, "non-retryable — manual attention may be required");
  }
}
