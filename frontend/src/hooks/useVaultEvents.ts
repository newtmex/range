"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePublicClient, useChainId } from "wagmi";
import type { PublicClient } from "viem";
import { VAULT_ABI } from "@/lib/contracts";
import { findDeploymentBlock } from "@/lib/blockSearch";

// Public Mezo RPC endpoints cap eth_getLogs to a 10,000-block range, so a
// naive fromBlock:"earliest" query throws on any chain with real history.
// Stay well under that, and start from the vault's actual deployment block
// (found via binary search on eth_getCode) instead of genesis.
const LOG_CHUNK_BLOCKS = 9000n;
// Chunk ranges are independent, so fetch several concurrently instead of one
// at a time — verified empirically: sequential chunking took 72-90+s (often
// never finishing within the 30s poll interval) for a vault whose deployment
// block sat ~39 days before its first real activity; bounded concurrency cut
// that to ~20-25s for the same range. Bounded (not unlimited) because each of
// the 4 event types below scans concurrently too — unlimited concurrency
// across all of them at once was enough to trip outright RPC HTTP failures
// elsewhere in this codebase.
const CHUNK_CONCURRENCY = 6;

async function getLogsChunked(
  client: PublicClient,
  params: {
    address: `0x${string}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any;
    fromBlock: bigint;
    toBlock: bigint;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const ranges: { start: bigint; end: bigint }[] = [];
  let start = params.fromBlock;
  while (start <= params.toBlock) {
    const end =
      start + LOG_CHUNK_BLOCKS > params.toBlock
        ? params.toBlock
        : start + LOG_CHUNK_BLOCKS;
    ranges.push({ start, end });
    start = end + 1n;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logs: any[] = [];
  for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) =>
        client.getLogs({
          address: params.address,
          event: params.event,
          fromBlock: r.start,
          toBlock: r.end,
        }),
      ),
    );
    for (const chunk of results) logs.push(...chunk);
  }
  return logs;
}

export interface RebalanceEvent {
  blockNumber: bigint;
  txHash: `0x${string}`;
  timestamp: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

export interface VaultEventsData {
  rebalances: RebalanceEvent[];
  rebalanceCount: number;
  totalFee0: bigint;
  totalFee1: bigint;
  firstEventTimestamp: number | undefined;
  isLoading: boolean;
}

/** Accumulated results from all prior scans of a vault, keyed by vault address. */
interface CachedEventState {
  lastScannedBlock: bigint;
  rebalances: RebalanceEvent[];
  totalFee0: bigint;
  totalFee1: bigint;
  firstEventTimestamp: number | undefined;
}

const REBALANCED_ABI = VAULT_ABI.find((x) => x.name === "Rebalanced" && x.type === "event")!;
const FEES_ABI = VAULT_ABI.find((x) => x.name === "FeesCollected" && x.type === "event")!;
const DEPOSIT_ABI = VAULT_ABI.find((x) => x.name === "Deposit" && x.type === "event")!;
const WITHDRAW_ABI = VAULT_ABI.find((x) => x.name === "Withdraw" && x.type === "event")!;

export function useVaultEvents(vaultAddress: `0x${string}`): VaultEventsData {
  const client = usePublicClient();
  const chainId = useChainId();

  const [data, setData] = useState<VaultEventsData>({
    rebalances: [],
    rebalanceCount: 0,
    totalFee0: BigInt(0),
    totalFee1: BigInt(0),
    firstEventTimestamp: undefined,
    isLoading: true,
  });

  // Cache the (expensive-ish) binary-searched deployment block per vault so
  // repeated polls don't redo it every 30s.
  const deployBlockCache = useRef<Map<string, bigint>>(new Map());
  // Cache accumulated log results per vault so each 30s poll only scans
  // blocks NEW since the last successful scan, instead of re-scanning the
  // vault's entire history from its deployment block every single time.
  const resultsCache = useRef<Map<string, CachedEventState>>(new Map());
  // Guards against overlapping scans: a full history scan can take longer
  // than the 30s poll interval, and setInterval doesn't wait for the
  // previous call to resolve — without this, a slow scan gets a second
  // (then third, then...) overlapping scan piled on top of it every 30s,
  // each competing for the same RPC and making the pile-up worse over time.
  const inFlight = useRef<Set<string>>(new Set());

  const fetchEvents = useCallback(async () => {
    if (!client) return;
    if (inFlight.current.has(vaultAddress)) return;
    inFlight.current.add(vaultAddress);
    try {
      const latest = await client.getBlockNumber();
      const cached = resultsCache.current.get(vaultAddress);

      if (cached && cached.lastScannedBlock >= latest) {
        // Nothing new since the last scan — republish the cached state.
        setData({
          rebalances: cached.rebalances,
          rebalanceCount: cached.rebalances.length,
          totalFee0: cached.totalFee0,
          totalFee1: cached.totalFee1,
          firstEventTimestamp: cached.firstEventTimestamp,
          isLoading: false,
        });
        return;
      }

      let fromBlock: bigint;
      if (cached) {
        fromBlock = cached.lastScannedBlock + 1n;
      } else {
        fromBlock =
          deployBlockCache.current.get(vaultAddress) ??
          (await findDeploymentBlock(client, vaultAddress, latest));
        deployBlockCache.current.set(vaultAddress, fromBlock);
      }

      const [rbLogs, feeLogs, depositLogs, withdrawLogs] = await Promise.all([
        getLogsChunked(client, {
          address: vaultAddress,
          event: REBALANCED_ABI,
          fromBlock,
          toBlock: latest,
        }),
        getLogsChunked(client, {
          address: vaultAddress,
          event: FEES_ABI,
          fromBlock,
          toBlock: latest,
        }),
        getLogsChunked(client, {
          address: vaultAddress,
          event: DEPOSIT_ABI,
          fromBlock,
          toBlock: latest,
        }),
        getLogsChunked(client, {
          address: vaultAddress,
          event: WITHDRAW_ABI,
          fromBlock,
          toBlock: latest,
        }),
      ]);

      // Collect unique block numbers, then fetch timestamps in parallel
      const blockNums = new Set<bigint>();
      for (const log of [...rbLogs, ...feeLogs, ...depositLogs, ...withdrawLogs]) {
        if (log.blockNumber != null) blockNums.add(log.blockNumber);
      }
      const tsMap = new Map<bigint, number>();
      await Promise.all(
        Array.from(blockNums).map(async (bn) => {
          try {
            const block = await client.getBlock({ blockNumber: bn });
            tsMap.set(bn, Number(block.timestamp));
          } catch { /* ignore */ }
        })
      );

      const ts = (bn: bigint | null) => (bn != null ? (tsMap.get(bn) ?? 0) : 0);

      const newRebalances: RebalanceEvent[] = rbLogs.map((log) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = log.args as any;
        return {
          blockNumber: log.blockNumber ?? BigInt(0),
          txHash: (log.transactionHash ?? "0x0") as `0x${string}`,
          timestamp: ts(log.blockNumber),
          tickLower: args.newTickLower as number,
          tickUpper: args.newTickUpper as number,
          liquidity: (args.newLiquidity ?? BigInt(0)) as bigint,
        };
      }).reverse(); // newest first

      const newFee0 = feeLogs.reduce((acc, log) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return acc + (((log.args as any).fee0 as bigint) ?? BigInt(0));
      }, BigInt(0));

      const newFee1 = feeLogs.reduce((acc, log) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return acc + (((log.args as any).fee1 as bigint) ?? BigInt(0));
      }, BigInt(0));

      const newTs = [
        ...rbLogs.map((l) => ts(l.blockNumber)),
        ...feeLogs.map((l) => ts(l.blockNumber)),
        ...depositLogs.map((l) => ts(l.blockNumber)),
        ...withdrawLogs.map((l) => ts(l.blockNumber)),
      ].filter(Boolean);

      // Merge with whatever was already accumulated from prior scans. New
      // rebalances come from later blocks, so they go in front of the
      // (already newest-first) cached list. firstEventTimestamp only ever
      // gets set once — later scans only look at blocks after it.
      const mergedRebalances = cached ? [...newRebalances, ...cached.rebalances] : newRebalances;
      const mergedFee0 = (cached?.totalFee0 ?? BigInt(0)) + newFee0;
      const mergedFee1 = (cached?.totalFee1 ?? BigInt(0)) + newFee1;
      const mergedFirstEventTimestamp =
        cached?.firstEventTimestamp ?? (newTs.length > 0 ? Math.min(...newTs) : undefined);

      const nextCache: CachedEventState = {
        lastScannedBlock: latest,
        rebalances: mergedRebalances,
        totalFee0: mergedFee0,
        totalFee1: mergedFee1,
        firstEventTimestamp: mergedFirstEventTimestamp,
      };
      resultsCache.current.set(vaultAddress, nextCache);

      setData({
        rebalances: mergedRebalances,
        rebalanceCount: mergedRebalances.length,
        totalFee0: mergedFee0,
        totalFee1: mergedFee1,
        firstEventTimestamp: mergedFirstEventTimestamp,
        isLoading: false,
      });
    } catch (e) {
      console.error("useVaultEvents:", e);
      setData((prev) => ({ ...prev, isLoading: false }));
    } finally {
      inFlight.current.delete(vaultAddress);
    }
  }, [client, chainId, vaultAddress]);

  useEffect(() => {
    fetchEvents();
    const id = setInterval(fetchEvents, 30_000);
    return () => clearInterval(id);
  }, [fetchEvents]);

  return data;
}
