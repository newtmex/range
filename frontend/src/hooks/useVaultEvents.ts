"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useChainId } from "wagmi";

// ── Subgraph endpoints ──────────────────────────────────────────────────────
// Events are served by a Goldsky instant subgraph (see /subgraph) instead of
// scanning eth_getLogs client-side. The subgraph indexes all vaults; every
// entity carries a `contractId_` field (the source vault address) so we filter
// per-vault. One HTTP round-trip replaces the old chunked-log / binary-search /
// per-block-timestamp / caching machinery.
const SUBGRAPH_URLS: Record<number, string | undefined> = {
  31611: process.env.NEXT_PUBLIC_SUBGRAPH_URL_TESTNET,
  31612: process.env.NEXT_PUBLIC_SUBGRAPH_URL_MAINNET,
};

// Single query fetches: all rebalances (newest first), all fee events, and the
// earliest event of each type (to derive the vault's first-activity timestamp).
// `first: 1000` is The Graph's max page size — plenty for testnet volume; add
// cursor pagination here if a vault ever exceeds it.
// NOTE on the filter: Goldsky tags every entity with `contractId_` (the source
// vault). Filtering a field whose name ends in `_` directly (`contractId_: x`)
// collides with The Graph's nested-filter syntax and errors ("no attribute
// contractId"), so we use the exact-match list operator `contractId__in`, which
// parses cleanly. Metadata fields are `block_number`, `timestamp_`,
// `transactionHash_` (all verified via schema introspection).
const VAULT_EVENTS_QUERY = `
  query VaultEvents($vault: [String!]) {
    rebalanceds(
      where: { contractId__in: $vault }
      orderBy: block_number
      orderDirection: desc
      first: 1000
    ) {
      newTickLower
      newTickUpper
      newLiquidity
      block_number
      timestamp_
      transactionHash_
    }
    feesCollecteds(where: { contractId__in: $vault }, first: 1000) {
      fee0
      fee1
    }
    firstRebalanced: rebalanceds(where: { contractId__in: $vault }, orderBy: timestamp_, orderDirection: asc, first: 1) { timestamp_ }
    firstFees: feesCollecteds(where: { contractId__in: $vault }, orderBy: timestamp_, orderDirection: asc, first: 1) { timestamp_ }
    firstDeposit: deposits(where: { contractId__in: $vault }, orderBy: timestamp_, orderDirection: asc, first: 1) { timestamp_ }
    firstWithdraw: withdraws(where: { contractId__in: $vault }, orderBy: timestamp_, orderDirection: asc, first: 1) { timestamp_ }
  }
`;

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
  rebalanceCount: number;
  totalFee0: bigint;
  totalFee1: bigint;
  firstEventTimestamp: number | undefined;
  isLoading: boolean;
}

// ── Raw GraphQL response shapes (metadata fields come back as strings) ────────
interface RawRebalanced {
  newTickLower: string | number;
  newTickUpper: string | number;
  newLiquidity: string;
  block_number: string;
  timestamp_: string;
  transactionHash_: string;
}
interface RawFees {
  fee0: string;
  fee1: string;
}
interface RawTs {
  timestamp_: string;
}
interface VaultEventsResponse {
  rebalanceds: RawRebalanced[];
  feesCollecteds: RawFees[];
  firstRebalanced: RawTs[];
  firstFees: RawTs[];
  firstDeposit: RawTs[];
  firstWithdraw: RawTs[];
}

const EMPTY: VaultEventsData = {
  rebalances: [],
  rebalanceCount: 0,
  totalFee0: BigInt(0),
  totalFee1: BigInt(0),
  firstEventTimestamp: undefined,
  isLoading: false,
};

function earliest(...groups: RawTs[][]): number | undefined {
  const stamps = groups
    .flat()
    .map((r) => Number(r.timestamp_))
    .filter((n) => Number.isFinite(n) && n > 0);
  return stamps.length ? Math.min(...stamps) : undefined;
}

export function useVaultEvents(vaultAddress: `0x${string}`): VaultEventsData {
  const chainId = useChainId();
  const subgraphUrl = SUBGRAPH_URLS[chainId];

  const [data, setData] = useState<VaultEventsData>({ ...EMPTY, isLoading: true });

  // Prevents overlapping polls from racing (a slow request shouldn't stack).
  const inFlight = useRef(false);

  const fetchEvents = useCallback(async () => {
    if (!subgraphUrl) {
      console.warn(
        `useVaultEvents: no subgraph URL configured for chain ${chainId} ` +
          "(set NEXT_PUBLIC_SUBGRAPH_URL_TESTNET / _MAINNET)",
      );
      setData({ ...EMPTY });
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const res = await fetch(subgraphUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: VAULT_EVENTS_QUERY,
          // `contractId__in` takes a list; Bytes filters must be lowercased.
          variables: { vault: [vaultAddress.toLowerCase()] },
        }),
      });

      const json: { data?: VaultEventsResponse; errors?: unknown } = await res.json();
      if (json.errors || !json.data) {
        throw new Error(`subgraph query failed: ${JSON.stringify(json.errors)}`);
      }
      const d = json.data;

      const rebalances: RebalanceEvent[] = d.rebalanceds.map((r) => ({
        blockNumber: BigInt(r.block_number),
        txHash: r.transactionHash_ as `0x${string}`,
        timestamp: Number(r.timestamp_),
        tickLower: Number(r.newTickLower),
        tickUpper: Number(r.newTickUpper),
        liquidity: BigInt(r.newLiquidity),
      }));

      const totalFee0 = d.feesCollecteds.reduce((a, f) => a + BigInt(f.fee0), BigInt(0));
      const totalFee1 = d.feesCollecteds.reduce((a, f) => a + BigInt(f.fee1), BigInt(0));

      setData({
        rebalances,
        rebalanceCount: rebalances.length,
        totalFee0,
        totalFee1,
        firstEventTimestamp: earliest(
          d.firstRebalanced,
          d.firstFees,
          d.firstDeposit,
          d.firstWithdraw,
        ),
        isLoading: false,
      });
    } catch (e) {
      console.error("useVaultEvents:", e);
      setData((prev) => ({ ...prev, isLoading: false }));
    } finally {
      inFlight.current = false;
    }
  }, [subgraphUrl, chainId, vaultAddress]);

  useEffect(() => {
    fetchEvents();
    const id = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchEvents]);

  return data;
}
