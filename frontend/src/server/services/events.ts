import "server-only";

import type { SupportedChainId } from "@/lib/chains";
import type { VaultEventsWire } from "@/lib/api/types";
import type { SubgraphRequest } from "../clients/subgraph";
import { cached, type CacheStore } from "../cache";

// Events are served by a Goldsky instant subgraph (see /subgraph) instead of
// scanning eth_getLogs. The subgraph indexes all vaults; every entity carries
// a `contractId_` field (the source vault address) so we filter per-vault.

// Single query fetches: all rebalances (newest first), all fee events, and the
// earliest event of each type (to derive the vault's first-activity timestamp).
// `first: 1000` is The Graph's max page size — plenty for current volume; add
// cursor pagination here if a vault ever exceeds it.
// NOTE on the filter: filtering a field whose name ends in `_` directly
// (`contractId_: x`) collides with The Graph's nested-filter syntax and errors
// ("no attribute contractId"), so we use the exact-match list operator
// `contractId__in`, which parses cleanly. Metadata fields are `block_number`,
// `timestamp_`, `transactionHash_` (all verified via schema introspection).
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

function earliest(...groups: RawTs[][]): number | null {
  const stamps = groups
    .flat()
    .map((r) => Number(r.timestamp_))
    .filter((n) => Number.isFinite(n) && n > 0);
  return stamps.length ? Math.min(...stamps) : null;
}

const EVENTS_CACHE_TTL_SECONDS = 30;

/**
 * Fetches and shapes a vault's event-derived analytics from the subgraph.
 * Cached briefly so polling across visitors collapses into one upstream query.
 */
export async function getVaultEvents(
  subgraph: SubgraphRequest,
  cache: CacheStore,
  chainId: SupportedChainId,
  vault: `0x${string}`,
): Promise<VaultEventsWire> {
  return cached(
    cache,
    `events:${chainId}:${vault.toLowerCase()}`,
    EVENTS_CACHE_TTL_SECONDS,
    async () => {
      const d = await subgraph<VaultEventsResponse>(chainId, VAULT_EVENTS_QUERY, {
        // `contractId__in` takes a list; Bytes filters must be lowercased.
        vault: [vault.toLowerCase()],
      });

      const rebalances = d.rebalanceds.map((r) => ({
        blockNumber: r.block_number,
        txHash: r.transactionHash_ as `0x${string}`,
        timestamp: Number(r.timestamp_),
        tickLower: Number(r.newTickLower),
        tickUpper: Number(r.newTickUpper),
        liquidity: r.newLiquidity,
      }));

      const totalFee0 = d.feesCollecteds.reduce((a, f) => a + BigInt(f.fee0), 0n);
      const totalFee1 = d.feesCollecteds.reduce((a, f) => a + BigInt(f.fee1), 0n);

      return {
        rebalances,
        rebalanceCount: rebalances.length,
        totalFee0: totalFee0.toString(),
        totalFee1: totalFee1.toString(),
        firstEventTimestamp: earliest(
          d.firstRebalanced,
          d.firstFees,
          d.firstDeposit,
          d.firstWithdraw,
        ),
      };
    },
  );
}
