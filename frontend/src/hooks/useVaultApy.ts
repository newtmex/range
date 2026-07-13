"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { usePublicClient } from "wagmi";
import {
  getVaultLensAddress,
  VAULT_LENS_ABI,
  VAULT_ABI,
} from "@/lib/contracts";
import { getArchiveClient } from "@/config/wagmi";
import { findBlockAtTimestamp } from "@/lib/blockSearch";

// ─────────────────────────────────────────────────────────────────────────────
// vaults.fyi APY methodology
// ─────────────────────────────────────────────────────────────────────────────
// APY is derived from the change in a vault's *share price* across fixed
// trailing windows (1d / 7d / 30d), read directly from onchain contracts —
// never from an instantaneous or self-reported rate.
//
//   share price      = total shares value / total shares
//   interest rate    = (current share price / previous share price) - 1
//
// To keep large TVL swings from over/under-stating yield, each pairwise ratio
// is weighted by the smaller (more conservative) TVL of the two observations:
//
//   weight_t         = min(TVL_t, TVL_(t-1))
//   interest rate    = ( Σ (sp_t / sp_(t-1)) · weight_t ) / ( Σ weight_t ) - 1
//
// The window interest rate is then annualized. This vault auto-compounds
// (collected fees are redeposited into the position), so we use the
// compounding form:
//
//   APY = (1 + interest rate) ^ (year / time) - 1
//
// where `time` is the window length in seconds and `year` is 31,536,000. The
// simple (non-compounding) alternative, kept here for reference, would be:
//
//   APY = interest rate · (year / time)
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
// hundreds of historical eth_call reads against a rate-limited public RPC.
// Sampling density does not change the math — Σ(ratio·weight)/Σ(weight) is
// scale-invariant in the number of observations — only how faithfully the
// series tracks the true hourly path.
const TARGET_SAMPLE_INTERVAL_SECONDS = 3600; // hourly
const MAX_SAMPLES_PER_WINDOW = 24;

// Public Mezo RPC nodes throttle bursts of concurrent requests; firing every
// historical read at once gets most of them rejected. Cap in-flight reads.
const SAMPLE_FETCH_CONCURRENCY = 4;

// A window is only reported if its successfully-read observations actually span
// a meaningful fraction of the requested (age-clamped) period. Annualization
// raises the observed growth to the power (year / observedSpan), so a window
// backed by only a few hours of data — e.g. because even the archive node
// couldn't serve the older blocks — explodes any noise into a garbage APY.
// Below this coverage ratio we return `undefined` rather than a misleading number.
const MIN_WINDOW_COVERAGE = 0.5;

const SHARE_PRICE_ABI = VAULT_LENS_ABI.filter((x) => x.name === "sharePrice");
const TOTAL_ASSETS_ABI = VAULT_ABI.filter((x) => x.name === "totalAssets");

type PublicClient = NonNullable<ReturnType<typeof usePublicClient>>;

/** One onchain observation: share price and TVL ("total shares value") at a block. */
interface ShareSample {
  /** Unix seconds (from the block header). */
  timestamp: number;
  /** Raw onchain share price = totalAssets · 10^decimals / totalSupply. */
  sharePrice: bigint;
  /** Raw onchain TVL = totalAssets. Used only as a relative weight. */
  tvl: bigint;
}

export interface VaultApy {
  /** Trailing 1-day APY, in percent. Most responsive to recent changes. */
  apy1d: number | undefined;
  /** Trailing 7-day APY, in percent. */
  apy7d: number | undefined;
  /** Trailing 30-day APY, in percent. Most stable, slowest to react. */
  apy30d: number | undefined;
  isLoading: boolean;
}

const EMPTY_APY: VaultApy = {
  apy1d: undefined,
  apy7d: undefined,
  apy30d: undefined,
  isLoading: false,
};

/**
 * Runs `worker` over `items` with at most `limit` in flight at once, preserving
 * input order in the returned settled results — a bounded replacement for an
 * unbounded Promise.allSettled against a rate-limited public RPC.
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

/** Reads share price + TVL at a historical block, forming one observation. */
async function fetchSampleAtBlock(
  client: PublicClient,
  lensAddress: `0x${string}`,
  vaultAddress: `0x${string}`,
  block: bigint,
): Promise<ShareSample> {
  const [sharePrice, tvl, blockInfo] = await Promise.all([
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
    client.getBlock({ blockNumber: block }),
  ]);

  return {
    timestamp: Number(blockInfo.timestamp),
    sharePrice: sharePrice as bigint,
    tvl: tvl as bigint,
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

/**
 * Computes the annualized APY for a single trailing window from a series of
 * onchain observations, following the vaults.fyi methodology exactly:
 *
 *   1. For each consecutive pair, ratio = sp_t / sp_(t-1).
 *   2. Weight each ratio by min(TVL_t, TVL_(t-1)).
 *   3. interest rate = Σ(ratio · weight) / Σ(weight) - 1.
 *   4. APY = (1 + interest rate) ^ (year / time) - 1, with `time` the observed
 *      span of the window in seconds.
 *
 * `samples` must be sorted ascending by timestamp. Returns APY in percent, or
 * undefined when the series can't support a well-defined result.
 */
function computeWindowApy(samples: ShareSample[]): number | undefined {
  if (samples.length < 2) return undefined;

  let weightedRatioSum = 0;
  let weightSum = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (prev.sharePrice <= 0n || cur.sharePrice <= 0n) continue;

    // ratio = sp_t / sp_(t-1), computed at BigInt precision then narrowed.
    const ratio =
      Number((cur.sharePrice * RATIO_SCALE) / prev.sharePrice) / 1e18;
    if (!Number.isFinite(ratio)) continue;

    // weight_t = min(TVL_t, TVL_(t-1)) — the conservative TVL of the pair.
    const minTvl = prev.tvl < cur.tvl ? prev.tvl : cur.tvl;
    const weight = Number(minTvl);
    if (weight <= 0) continue;

    weightedRatioSum += ratio * weight;
    weightSum += weight;
  }

  if (weightSum <= 0) return undefined;

  // TVL-weighted interest rate over the window.
  const interestRate = weightedRatioSum / weightSum - 1;

  // `time` = length of the window in seconds (the observed span).
  const time = samples[samples.length - 1].timestamp - samples[0].timestamp;
  if (time <= 0) return undefined;

  // Compounding annualization: APY = (1 + rate)^(year/time) - 1.
  const base = 1 + interestRate;
  if (base <= 0) return undefined;
  const apy = (Math.pow(base, SECONDS_PER_YEAR / time) - 1) * 100;
  return Number.isFinite(apy) ? apy : undefined;
}

/** Chooses a sampling interval that targets hourly reads but caps total samples. */
function sampleInterval(windowSeconds: number): number {
  return Math.max(
    TARGET_SAMPLE_INTERVAL_SECONDS,
    Math.ceil(windowSeconds / MAX_SAMPLES_PER_WINDOW),
  );
}

/**
 * Computes trailing 1d / 7d / 30d APY for a vault from its onchain share-price
 * history, per the vaults.fyi methodology (TVL-weighted, compounding).
 *
 * A window whose start predates the vault's first activity is clamped to that
 * point; a window with no queryable history (e.g. pruned state on a public RPC)
 * simply resolves to `undefined`.
 */
export function useVaultApy(
  vaultAddress: `0x${string}`,
  chainId: number | undefined,
  firstEventTimestamp: number | undefined,
): VaultApy {
  const client = usePublicClient();
  // Dedicated archive client for historical state reads. Falls back to the live
  // client at the call site when no archive URL is configured for the chain.
  const archiveClient = useMemo(
    () => getArchiveClient(chainId) as PublicClient | undefined,
    [chainId],
  );
  const [result, setResult] = useState<VaultApy>({
    ...EMPTY_APY,
    isLoading: true,
  });

  const computeWindow = useCallback(
    async (
      client: PublicClient,
      archiveClient: PublicClient,
      lensAddress: `0x${string}`,
      latest: bigint,
      now: number,
      windowSeconds: number,
    ): Promise<number | undefined> => {
      // Clamp the window start to the vault's first activity — never annualize
      // a period before the vault existed.
      const windowStart = Math.max(
        now - windowSeconds,
        firstEventTimestamp ?? 0,
      );
      const requestedSpan = now - windowStart;
      if (requestedSpan <= 0) return undefined;

      // Block-number estimation only reads block headers, which pruned public
      // nodes still serve — so it stays on the (live) client.
      const sampleBlocks = await estimateSampleBlocks(
        client,
        latest,
        now,
        windowStart,
        sampleInterval(windowSeconds),
      );
      if (sampleBlocks.length < 2) return undefined;

      // Historical share-price / TVL reads are `eth_call`s against past state,
      // which the live public node prunes — route these through the archive
      // client (which falls back to the live client when none is configured).
      const samples = await fetchWindowSamples(
        archiveClient,
        lensAddress,
        vaultAddress,
        sampleBlocks,
      );
      if (samples.length < 2) return undefined;

      // Span guard: suppress windows whose readable history covers too little
      // of the requested period, since annualizing a tiny span produces a
      // wildly amplified, untrustworthy APY.
      const observedSpan =
        samples[samples.length - 1].timestamp - samples[0].timestamp;
      if (observedSpan < requestedSpan * MIN_WINDOW_COVERAGE) return undefined;

      return computeWindowApy(samples);
    },
    [vaultAddress, firstEventTimestamp],
  );

  const fetchApy = useCallback(async () => {
    if (!client || firstEventTimestamp === undefined) {
      setResult({ ...EMPTY_APY });
      return;
    }

    setResult((prev) => ({ ...prev, isLoading: true }));
    try {
      const lensAddress = getVaultLensAddress(chainId);
      const latest = await client.getBlockNumber();
      const latestBlock = await client.getBlock({ blockNumber: latest });
      const now = Number(latestBlock.timestamp);

      const keys = Object.keys(WINDOWS) as WindowKey[];
      // Each window is independent; a failure in one (e.g. pruned history for
      // 30d) shouldn't sink the others.
      const settled = await Promise.allSettled(
        keys.map((k) =>
          computeWindow(
            client,
            archiveClient ?? client,
            lensAddress,
            latest,
            now,
            WINDOWS[k],
          ),
        ),
      );

      const next: VaultApy = { ...EMPTY_APY, isLoading: false };
      keys.forEach((k, i) => {
        const r = settled[i];
        next[k] = r.status === "fulfilled" ? r.value : undefined;
      });
      setResult(next);
    } catch (e) {
      console.error("useVaultApy:", e);
      setResult({ ...EMPTY_APY });
    }
  }, [client, archiveClient, chainId, firstEventTimestamp, computeWindow]);

  useEffect(() => {
    fetchApy();
  }, [fetchApy]);

  return result;
}
