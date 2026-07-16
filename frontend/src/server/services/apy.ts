import "server-only";

import type { PublicClient } from "viem";
import {
  getVaultLensAddress,
  VAULT_LENS_ABI,
  VAULT_ABI,
} from "@/lib/contracts";
import { isMusdToken0 } from "@/lib/utils";
import type { SupportedChainId } from "@/lib/chains";
import type { VaultApyWire } from "@/lib/api/types";
import type { RpcClients } from "../clients/rpc";
import type { SubgraphRequest } from "../clients/subgraph";
import { cached, type CacheStore } from "../cache";
import { findBlockAtTimestamp } from "../utils/blockSearch";
import { logger, errorField } from "../logger";
import { getVaultEvents } from "./events";

// ─────────────────────────────────────────────────────────────────────────────
// APY methodology (vaults.fyi share-price method, MUSD-denominated)
// ─────────────────────────────────────────────────────────────────────────────
// APY is derived from the change in a vault's *share price* across fixed
// trailing windows (1d / 7d / 30d), read directly from onchain contracts —
// never from an instantaneous or self-reported rate.
//
// The onchain share price (VaultLens.sharePrice) is denominated in token0 —
// BTC on mainnet. In BTC terms a ~50%-MUSD LP position loses value whenever
// BTC rallies, so a BTC-denominated APY tracks market direction more than
// yield (and contradicts the MUSD-denominated TVL shown alongside it). We
// therefore re-denominate every observation into MUSD using the pool price at
// that same block:
//
//   share price (MUSD) = share price (token0) · pool price   (token0 ≠ MUSD)
//   share price (MUSD) = share price (token0)                (token0 = MUSD)
//
// The pool price used is spot (slot0) at the sampled block. Spot is
// manipulable within a block, but observations are ~hourly and TVL-weighted,
// and this figure is display-only — while historical TWAP reads can revert
// entirely when the pool's observation cardinality is too low.
//
// Each pairwise growth ratio is weighted by the smaller (more conservative)
// MUSD TVL of the two observations, per the vaults.fyi methodology:
//
//   weight_t         = min(TVL_t, TVL_(t-1))
//   interest rate    = ( Σ (sp_t / sp_(t-1)) · weight_t ) / ( Σ weight_t ) - 1
//
// The window interest rate is then annualized with the compounding form:
//
//   APY = (1 + interest rate) ^ (year / time) - 1
//
// where `time` is the observed window span in seconds and `year` is
// 31,536,000.
//
// INTENTIONAL: `interest rate` is the weighted mean of *per-sampling-interval*
// ratios, while `time` is the whole window — so the exponent deliberately
// understates strict per-interval compounding by ~the number of samples. This
// damping keeps one day of LP price movement (which annualizes to thousands
// of percent when compounded per-hour) from dominating the displayed figure.
// Do not "fix" the exponent to per-interval time; that was tried and reverted
// by explicit product decision (2026-07-14).
// ─────────────────────────────────────────────────────────────────────────────

/** Seconds in a (non-leap) year, per the methodology. */
const SECONDS_PER_YEAR = 31_536_000;

/** Fixed trailing windows, in seconds. */
const WINDOWS = {
  apy1d: 1 * 24 * 3600,
  apy7d: 7 * 24 * 3600,
  apy30d: 30 * 24 * 3600,
} as const;

type WindowKey = keyof typeof WINDOWS;

// vaults.fyi reads share price hourly. We target that cadence but cap the
// number of observations per window so a 30-day window doesn't fan out into
// hundreds of historical eth_call reads against a rate-limited RPC. Sampling
// density does not change the math — Σ(ratio·weight)/Σ(weight) is
// scale-invariant in the number of observations — only how faithfully the
// series tracks the true hourly path.
const TARGET_SAMPLE_INTERVAL_SECONDS = 3600; // hourly
const MAX_SAMPLES_PER_WINDOW = 24;

// Even archive nodes throttle bursts of concurrent requests; firing every
// historical read at once gets most of them rejected. Cap in-flight reads.
const SAMPLE_FETCH_CONCURRENCY = 4;

// A window is only reported if its successfully-read observations actually span
// a meaningful fraction of the requested (age-clamped) period. Annualization
// raises the observed growth to the power (year / observedSpan), so a window
// backed by only a few hours of data — e.g. because even the archive node
// couldn't serve the older blocks — explodes any noise into a garbage APY.
// Below this coverage ratio we return null rather than a misleading number.
const MIN_WINDOW_COVERAGE = 0.5;

// The full pipeline costs a block binary-search plus up to ~24 archive reads
// per window; one cached figure serves every visitor for the TTL.
const APY_CACHE_TTL_SECONDS = 300;

const SHARE_PRICE_ABI = VAULT_LENS_ABI.filter((x) => x.name === "sharePrice");
const POOL_STATE_ABI = VAULT_LENS_ABI.filter((x) => x.name === "getPoolState");
const TOTAL_ASSETS_ABI = VAULT_ABI.filter((x) => x.name === "totalAssets");

/** One onchain observation: share price, TVL and pool price at a block. */
interface ShareSample {
  /** Unix seconds (from the block header). */
  timestamp: number;
  /** Raw onchain share price = totalAssets · 10^decimals / totalSupply, in token0. */
  sharePrice: bigint;
  /** Raw onchain TVL = totalAssets, in token0. Used only as a relative weight. */
  tvl: bigint;
  /** Pool spot sqrtPriceX96 at the same block, for token0 → MUSD conversion. */
  sqrtPriceX96: bigint;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight at once, preserving
 * input order in the returned settled results — a bounded replacement for an
 * unbounded Promise.allSettled against a rate-limited RPC.
 */
async function settleWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  async function runOne(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  const runners = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    runOne,
  );
  await Promise.all(runners);
  return results;
}

/**
 * Estimates the block numbers at each sample timestamp in [windowStart, now]
 * using a single binary search (for the oldest anchor block) plus linear
 * interpolation from the observed average block time — rather than a binary
 * search per sample. Block headers (and thus timestamps) remain available on
 * pruned nodes even when historical state does not, so this is always safe.
 */
async function estimateSampleBlocks(
  client: PublicClient,
  latest: bigint,
  now: number,
  windowStart: number,
  intervalSeconds: number,
): Promise<{ block: bigint; targetTimestamp: number }[]> {
  const oldestBlock = await findBlockAtTimestamp(
    client,
    BigInt(Math.max(windowStart, 0)),
    latest,
  );
  if (oldestBlock >= latest) return [];

  const oldestInfo = await client.getBlock({ blockNumber: oldestBlock });
  const blockSpan = Number(latest - oldestBlock);
  const timeSpan = now - Number(oldestInfo.timestamp);
  if (blockSpan <= 0 || timeSpan <= 0) return [];
  const avgBlockTimeSeconds = timeSpan / blockSpan;

  const samples: { block: bigint; targetTimestamp: number }[] = [];
  for (let t = windowStart; t <= now; t += intervalSeconds) {
    const secondsAgo = now - t;
    const blocksAgo = BigInt(
      Math.max(Math.round(secondsAgo / avgBlockTimeSeconds), 0),
    );
    const block = blocksAgo < latest ? latest - blocksAgo : oldestBlock;
    samples.push({ block, targetTimestamp: t });
  }
  // Ensure the newest observation is exactly `latest`, unless the loop already
  // landed on `now` (avoids a duplicate, zero-length pairwise interval).
  const last = samples[samples.length - 1];
  if (!last || last.targetTimestamp !== now) {
    samples.push({ block: latest, targetTimestamp: now });
  }
  return samples;
}

/** Reads share price + TVL + pool price at a historical block, forming one observation. */
async function fetchSampleAtBlock(
  client: PublicClient,
  lensAddress: `0x${string}`,
  vaultAddress: `0x${string}`,
  block: bigint,
): Promise<ShareSample> {
  const [sharePrice, tvl, poolState, blockInfo] = await Promise.all([
    client.readContract({
      address: lensAddress,
      abi: SHARE_PRICE_ABI,
      functionName: "sharePrice",
      args: [vaultAddress],
      blockNumber: block,
    }),
    client.readContract({
      address: vaultAddress,
      abi: TOTAL_ASSETS_ABI,
      functionName: "totalAssets",
      blockNumber: block,
    }),
    client.readContract({
      address: lensAddress,
      abi: POOL_STATE_ABI,
      functionName: "getPoolState",
      args: [vaultAddress],
      blockNumber: block,
    }),
    client.getBlock({ blockNumber: block }),
  ]);

  const [sqrtPriceX96] = poolState as readonly [bigint, number];
  return {
    timestamp: Number(blockInfo.timestamp),
    sharePrice: sharePrice as bigint,
    tvl: tvl as bigint,
    sqrtPriceX96,
  };
}

/**
 * Fetches one observation per block, tolerating individual failures: reading
 * share price at a historical block can revert (e.g. the pool oracle's TWAP
 * window not covering that block, or pruned state). A sparser series still
 * yields a valid weighted average, so one bad read shouldn't abort the window.
 */
async function fetchWindowSamples(
  client: PublicClient,
  lensAddress: `0x${string}`,
  vaultAddress: `0x${string}`,
  sampleBlocks: { block: bigint }[],
): Promise<ShareSample[]> {
  const settled = await settleWithConcurrency(
    sampleBlocks,
    SAMPLE_FETCH_CONCURRENCY,
    ({ block }) => fetchSampleAtBlock(client, lensAddress, vaultAddress, block),
  );
  return settled
    .filter(
      (r): r is PromiseFulfilledResult<ShareSample> => r.status === "fulfilled",
    )
    .map((r) => r.value)
    .sort((a, b) => a.timestamp - b.timestamp);
}

// Scale factor for computing the share-price ratio with BigInt precision before
// narrowing to a float. Raw share prices are ~1e18, so a Number division would
// lose the small yield signal (the change lives in the ~16th significant
// digit). Dividing (sp_t · 1e18) / sp_(t-1) as BigInt first preserves it.
const RATIO_SCALE = 1_000_000_000_000_000_000n; // 1e18

/** 2^96 as a float, for converting sqrtPriceX96 into a plain price factor. */
const Q96 = 2 ** 96;

/**
 * Share price re-denominated into MUSD, as an unnormalized BigInt. When token0
 * is not MUSD, multiplies by the pool price sqrtP² — the 2^192 scale factor is
 * deliberately NOT divided out, since only pairwise *ratios* of these values
 * are ever taken and the constant cancels (dividing here would throw away the
 * precision the BigInt path exists to keep).
 */
function sharePriceMusd(s: ShareSample, convertToMusd: boolean): bigint {
  if (!convertToMusd) return s.sharePrice;
  return s.sharePrice * s.sqrtPriceX96 * s.sqrtPriceX96;
}

/** TVL re-denominated into MUSD, as a float — used only as a relative weight. */
function tvlMusd(s: ShareSample, convertToMusd: boolean): number {
  const tvl = Number(s.tvl);
  if (!convertToMusd) return tvl;
  const price = (Number(s.sqrtPriceX96) / Q96) ** 2;
  return tvl * price;
}

/**
 * Computes the annualized APY for a single trailing window from a series of
 * onchain observations (see the methodology block at the top of this file):
 *
 *   1. Re-denominate each observation into MUSD.
 *   2. For each consecutive pair, ratio = sp_t / sp_(t-1).
 *   3. Weight each ratio by min(TVL_t, TVL_(t-1)) in MUSD.
 *   4. interest rate = Σ(ratio · weight) / Σ(weight) - 1.
 *   5. APY = (1 + interest rate) ^ (year / time) - 1, with `time` the observed
 *      span of the window in seconds (deliberately damped — see header).
 *
 * `samples` must be sorted ascending by timestamp. Returns APY in percent, or
 * null when the series can't support a well-defined result.
 */
function computeWindowApy(
  samples: ShareSample[],
  convertToMusd: boolean,
): number | null {
  if (samples.length < 2) return null;

  let weightedRatioSum = 0;
  let weightSum = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (prev.sharePrice <= 0n || cur.sharePrice <= 0n) continue;
    if (convertToMusd && (prev.sqrtPriceX96 <= 0n || cur.sqrtPriceX96 <= 0n))
      continue;

    // ratio = sp_t / sp_(t-1) in MUSD, computed at BigInt precision then narrowed.
    const spPrev = sharePriceMusd(prev, convertToMusd);
    const spCur = sharePriceMusd(cur, convertToMusd);
    const ratio = Number((spCur * RATIO_SCALE) / spPrev) / 1e18;
    if (!Number.isFinite(ratio)) continue;

    // weight_t = min(TVL_t, TVL_(t-1)) — the conservative MUSD TVL of the pair.
    const weight = Math.min(
      tvlMusd(prev, convertToMusd),
      tvlMusd(cur, convertToMusd),
    );
    if (weight <= 0) continue;

    weightedRatioSum += ratio * weight;
    weightSum += weight;
  }

  if (weightSum <= 0) return null;

  // TVL-weighted interest rate over the window.
  const interestRate = weightedRatioSum / weightSum - 1;

  // `time` = length of the window in seconds (the observed span).
  const time = samples[samples.length - 1].timestamp - samples[0].timestamp;
  if (time <= 0) return null;

  // Compounding annualization: APY = (1 + rate)^(year/time) - 1.
  const base = 1 + interestRate;
  if (base <= 0) return null;
  const apy = (Math.pow(base, SECONDS_PER_YEAR / time) - 1) * 100;
  return Number.isFinite(apy) ? apy : null;
}

/** Chooses a sampling interval that targets hourly reads but caps total samples. */
function sampleInterval(windowSeconds: number): number {
  return Math.max(
    TARGET_SAMPLE_INTERVAL_SECONDS,
    Math.ceil(windowSeconds / MAX_SAMPLES_PER_WINDOW),
  );
}

async function computeWindow(
  clients: RpcClients,
  chainId: SupportedChainId,
  vault: `0x${string}`,
  latest: bigint,
  now: number,
  windowSeconds: number,
  firstEventTimestamp: number,
  convertToMusd: boolean,
): Promise<number | null> {
  // Clamp the window start to the vault's first activity — never annualize
  // a period before the vault existed.
  const windowStart = Math.max(now - windowSeconds, firstEventTimestamp);
  const requestedSpan = now - windowStart;
  if (requestedSpan <= 0) return null;

  // Block-number estimation only reads block headers, which pruned public
  // nodes still serve — so it stays on the live client.
  const sampleBlocks = await estimateSampleBlocks(
    clients.live,
    latest,
    now,
    windowStart,
    sampleInterval(windowSeconds),
  );
  if (sampleBlocks.length < 2) return null;

  // Historical share-price / TVL reads are `eth_call`s against past state,
  // which live public nodes prune — route these through the archive client
  // (which falls back to the live client when none is configured).
  const samples = await fetchWindowSamples(
    clients.archive,
    getVaultLensAddress(chainId),
    vault,
    sampleBlocks,
  );
  if (samples.length < 2) return null;

  // Span guard: suppress windows whose readable history covers too little
  // of the requested period, since annualizing a tiny span produces a
  // wildly amplified, untrustworthy APY.
  const observedSpan =
    samples[samples.length - 1].timestamp - samples[0].timestamp;
  if (observedSpan < requestedSpan * MIN_WINDOW_COVERAGE) return null;

  return computeWindowApy(samples, convertToMusd);
}

/**
 * Computes trailing 1d / 7d / 30d APY for a vault from its onchain share-price
 * history, per the vaults.fyi methodology (TVL-weighted, compounding).
 *
 * A window whose start predates the vault's first activity is clamped to that
 * point; a window with no queryable history (e.g. pruned state) resolves to
 * null. The whole result is cached — the pipeline fans out into dozens of
 * archive reads, and one figure per TTL serves every visitor.
 */
export async function getVaultApy(
  clients: RpcClients,
  subgraph: SubgraphRequest,
  cache: CacheStore,
  chainId: SupportedChainId,
  vault: `0x${string}`,
): Promise<VaultApyWire> {
  return cached(
    cache,
    `apy:${chainId}:${vault.toLowerCase()}`,
    APY_CACHE_TTL_SECONDS,
    async () => {
      // APY is anchored to the vault's first activity, derived from the
      // subgraph. A vault that has never been touched has no share-price
      // history to annualize — that's an empty result, not a failure.
      const events = await getVaultEvents(subgraph, cache, chainId, vault);
      if (events.firstEventTimestamp === null) {
        return { apy1d: null, apy7d: null, apy30d: null };
      }
      const firstEventTimestamp = events.firstEventTimestamp;

      // The onchain share price is in token0; when token0 isn't MUSD (mainnet,
      // where token0 = BTC) every observation is re-denominated into MUSD.
      const convertToMusd = !isMusdToken0(chainId);

      const latest = await clients.live.getBlockNumber();
      const latestBlock = await clients.live.getBlock({ blockNumber: latest });
      const now = Number(latestBlock.timestamp);

      const keys = Object.keys(WINDOWS) as WindowKey[];
      // Each window is independent; a failure in one (e.g. pruned history for
      // 30d) shouldn't sink the others.
      const settled = await Promise.allSettled(
        keys.map((k) =>
          computeWindow(
            clients,
            chainId,
            vault,
            latest,
            now,
            WINDOWS[k],
            firstEventTimestamp,
            convertToMusd,
          ),
        ),
      );

      const result: VaultApyWire = { apy1d: null, apy7d: null, apy30d: null };
      keys.forEach((k, i) => {
        const r = settled[i];
        if (r.status === "fulfilled") {
          result[k] = r.value;
        } else {
          logger.warn("apy window failed", {
            upstream: "archive",
            chainId,
            vault,
            window: k,
            error: errorField(r.reason),
          });
        }
      });
      return result;
    },
  );
}
