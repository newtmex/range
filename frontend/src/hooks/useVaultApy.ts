"use client";

import { useEffect, useState, useCallback } from "react";
import { usePublicClient } from "wagmi";
import {
  getVaultLensAddress,
  VAULT_LENS_ABI,
  VAULT_ABI,
} from "@/lib/contracts";
import { findBlockAtTimestamp } from "@/lib/blockSearch";
import {
  computeTrailingApy,
  tickToPrice,
  toMusdFromToken0,
  type ApySample,
} from "@/lib/utils";

// Public Mezo RPC nodes are pruned, not archive — historical eth_call state
// is only available for a limited trailing window (verified empirically:
// ~3.5 days on mainnet, longer on testnet). Stay well under that ceiling so
// every sample block is actually queryable, and keep a safety margin since
// retention can vary by node/load.
//
// This window doubles as a minimum vault age: a vault younger than
// WINDOW_SECONDS shows no APY at all rather than annualizing its
// bootstrapping period (a fresh, dust-sized deposit's first day of price
// action is not a meaningful yield signal, no matter how it's smoothed).
// Set short (6h) for active testing/demo cycles, where vaults get redeployed
// often and waiting even a day for a number isn't practical — at this length
// there's very little smoothing data (5 pairwise intervals), so this is
// closer to the original two-point comparison that produced the 9474% bug;
// the TVL-weighted smoothing + sanity clamp in computeTrailingApy are the
// only backstop against noise here. Widen this once vaults are longer-lived.
const WINDOW_SECONDS = 24 * 3600; // 24 hours
const SAMPLE_INTERVAL_SECONDS = 2 * 3600; // 2 hours between snapshots (6 samples, 5 pairwise intervals)

const SHARE_PRICE_ABI = VAULT_LENS_ABI.filter((x) => x.name === "sharePrice");
const POOL_STATE_ABI = VAULT_LENS_ABI.filter((x) => x.name === "getPoolState");
const TOTAL_SUPPLY_ABI = VAULT_ABI.filter((x) => x.name === "totalSupply");

type PublicClient = NonNullable<ReturnType<typeof usePublicClient>>;

function isVaultOldEnough(now: number, firstEventTimestamp: number): boolean {
  return now - firstEventTimestamp >= WINDOW_SECONDS;
}

/**
 * Estimates block numbers for each sample timestamp in the window using one
 * binary search (for the oldest, retention-bounded anchor) plus linear
 * interpolation from the observed average block time — instead of a fresh
 * binary search per sample, which would multiply RPC calls by the sample
 * count. Blocks are approximately, not exactly, on the target timestamps;
 * that's fine for a trailing-average APY estimate.
 */
async function estimateSampleBlocks(
  client: PublicClient,
  latest: bigint,
  now: number,
  windowStart: number,
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
  for (let t = windowStart; t <= now; t += SAMPLE_INTERVAL_SECONDS) {
    const secondsAgo = now - t;
    const blocksAgo = BigInt(
      Math.max(Math.round(secondsAgo / avgBlockTimeSeconds), 0),
    );
    const block = blocksAgo < latest ? latest - blocksAgo : oldestBlock;
    samples.push({ block, targetTimestamp: t });
  }
  // Always include the latest block as the newest sample, unless the loop
  // above already landed exactly on `now` (e.g. WINDOW_SECONDS is an exact
  // multiple of SAMPLE_INTERVAL_SECONDS) — otherwise this duplicates the
  // last loop sample, producing a zero-second pairwise interval that skews
  // computeTrailingApy's annualization.
  if (
    samples.length === 0 ||
    samples[samples.length - 1].targetTimestamp !== now
  ) {
    samples.push({ block: latest, targetTimestamp: now });
  }
  return samples;
}

/** Reads vault + pool state at a historical block and converts it into one APY sample point. */
async function fetchSampleAtBlock(
  client: PublicClient,
  lensAddress: `0x${string}`,
  vaultAddress: `0x${string}`,
  block: bigint,
  decimals0: number,
  decimals1: number,
  isToken0Musd: boolean,
): Promise<ApySample> {
  const [sharePrice, poolState, totalSupply, blockInfo] = await Promise.all([
    client.readContract({
      address: lensAddress,
      abi: SHARE_PRICE_ABI,
      functionName: "sharePrice",
      args: [vaultAddress],
      blockNumber: block,
    }),
    client.readContract({
      address: lensAddress,
      abi: POOL_STATE_ABI,
      functionName: "getPoolState",
      args: [vaultAddress],
      blockNumber: block,
    }),
    client.readContract({
      address: vaultAddress,
      abi: TOTAL_SUPPLY_ABI,
      functionName: "totalSupply",
      blockNumber: block,
    }),
    client.getBlock({ blockNumber: block }),
  ]);

  const tick = (poolState as [bigint, number])[1];
  const price = tickToPrice(tick, decimals0, decimals1);
  const shareValueMusd = toMusdFromToken0(
    Number(sharePrice),
    price,
    isToken0Musd,
  );
  // Vault "value" proxy used only as a relative weight (min(tvl_t, tvl_t-1))
  // — reconstructed from sharePrice x totalSupply instead of reading
  // getVaultMetrics().tvl, since totalSupply() is a plain ERC20 read
  // (no TWAP dependency, unlike totalAssets()/getVaultMetrics()).
  const tvl = Number(sharePrice) * Number(totalSupply);

  return { timestamp: Number(blockInfo.timestamp), shareValueMusd, tvl };
}

/**
 * Fetches one sample per block, tolerating individual failures: sharePrice()
 * internally reads a TWAP (via the vault's totalAssets()), which can
 * intermittently revert with "OLD" at a historical block — a known gap in
 * the pool oracle's observation cardinality, not something this hook can
 * fix. computeTrailingApy already handles a sparser series, so one bad
 * sample shouldn't abort the whole computation.
 */
async function fetchApySamples(
  client: PublicClient,
  lensAddress: `0x${string}`,
  vaultAddress: `0x${string}`,
  sampleBlocks: { block: bigint }[],
  decimals0: number,
  decimals1: number,
  isToken0Musd: boolean,
): Promise<ApySample[]> {
  const settled = await Promise.allSettled(
    sampleBlocks.map(({ block }) =>
      fetchSampleAtBlock(
        client,
        lensAddress,
        vaultAddress,
        block,
        decimals0,
        decimals1,
        isToken0Musd,
      ),
    ),
  );
  return settled
    .filter(
      (r): r is PromiseFulfilledResult<ApySample> => r.status === "fulfilled",
    )
    .map((r) => r.value)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function useVaultApy(
  vaultAddress: `0x${string}`,
  chainId: number | undefined,
  firstEventTimestamp: number | undefined,
  decimals0: number,
  decimals1: number,
  isToken0Musd: boolean,
): number | undefined {
  const client = usePublicClient();
  const [apy, setApy] = useState<number | undefined>(undefined);

  const fetchApy = useCallback(async () => {
    if (!client || firstEventTimestamp === undefined) {
      console.warn("useVaultApy: missing client or firstEventTimestamp");
      setApy(undefined);
      return;
    }
  
    
    try {
      const lensAddress = getVaultLensAddress(chainId);
      const latest = await client.getBlockNumber();
      const latestBlockInfo = await client.getBlock({ blockNumber: latest });
      const now = Number(latestBlockInfo.timestamp);

      // Re-check against the chain's own clock, since block time can lag wall-clock time.
      if (!isVaultOldEnough(now, firstEventTimestamp)) {
        setApy(undefined);
        return;
      }

      const windowStart = now - WINDOW_SECONDS;
      const sampleBlocks = await estimateSampleBlocks(
        client,
        latest,
        now,
        windowStart,
      );
      if (sampleBlocks.length < 2) {
        setApy(undefined);
        return;
      }

      const samples = await fetchApySamples(
        client,
        lensAddress,
        vaultAddress,
        sampleBlocks,
        decimals0,
        decimals1,
        isToken0Musd,
      );
      console.log(
        "useVaultApy: fetched",
        samples.length,
        "samples for APY computation",
        samples,
      );

      const computed = computeTrailingApy(samples);
      setApy(computed);
      console.log(
        "useVaultApy: computed APY",
        computed,
        "from",
        samples.length,
        "samples",
      );
    } catch (e) {
      console.error("useVaultApy:", e);
      setApy(undefined);
    }
  }, [
    client,
    vaultAddress,
    chainId,
    firstEventTimestamp,
    decimals0,
    decimals1,
    isToken0Musd,
  ]);

  useEffect(() => {
    fetchApy();
  }, [fetchApy]);
  console.log(apy, "vault apy");
  return apy;
}
