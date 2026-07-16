"use client";

import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { fetchApi } from "@/lib/api/client";
import type { VaultEventsWire } from "@/lib/api/types";

// Event-derived analytics (rebalances, fees, first activity) come from the
// backend's /events endpoint, which queries the Goldsky subgraph server-side
// and caches briefly. The subgraph URL never reaches the client.

const POLL_INTERVAL_MS = 30_000;

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
  // Undefined until the first successful fetch. Seeding these with 0 / 0n
  // would be indistinguishable from a genuine "this vault has never rebalanced
  // and earned no fees" — a zero is only truthful once it comes back from the
  // backend.
  rebalanceCount: number | undefined;
  totalFee0: bigint | undefined;
  totalFee1: bigint | undefined;
  firstEventTimestamp: number | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function useVaultEvents(vaultAddress: `0x${string}`): VaultEventsData {
  const chainId = useChainId();

  const query = useQuery({
    queryKey: ["vault-events", chainId, vaultAddress],
    queryFn: () =>
      fetchApi<VaultEventsWire>(
        `/api/v1/vaults/${chainId}/${vaultAddress}/events`,
      ),
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
  });

  const d = query.data;
  if (!d) {
    return {
      rebalances: [],
      rebalanceCount: undefined,
      totalFee0: undefined,
      totalFee1: undefined,
      firstEventTimestamp: undefined,
      isLoading: !query.isError,
      isError: query.isError,
    };
  }

  // A failed background poll keeps the last data on screen (react-query
  // retains `data` across refetch errors); isError only surfaces in the UI
  // for stats that have no value to fall back on.
  return {
    rebalances: d.rebalances.map((r) => ({
      blockNumber: BigInt(r.blockNumber),
      txHash: r.txHash,
      timestamp: r.timestamp,
      tickLower: r.tickLower,
      tickUpper: r.tickUpper,
      liquidity: BigInt(r.liquidity),
    })),
    rebalanceCount: d.rebalanceCount,
    totalFee0: BigInt(d.totalFee0),
    totalFee1: BigInt(d.totalFee1),
    firstEventTimestamp: d.firstEventTimestamp ?? undefined,
    isLoading: false,
    isError: query.isError,
  };
}
