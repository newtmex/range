"use client";

import { useVaultPage } from "./useVaultPage";
import { getStrategyVaultAddress } from "@/lib/strategies";
import { MEZO_MAINNET_ID } from "@/lib/utils";

export interface AggregatedVaultStats {
  tvlMusd: number | undefined;
  feesMusd: number | undefined;
  rebalanceCount: number | undefined;
}

function sumDefined(values: (number | undefined)[]): number | undefined {
  if (values.some((v) => v === undefined)) return undefined;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/**
 * Aggregates TVL, fees earned, and rebalance count across the three
 * mainnet strategy vaults (Tight/Medium/Wide), for the landing page's
 * stats section. Always reads mainnet regardless of the visitor's
 * connected chain — marketing content shouldn't flip to trivial
 * testnet numbers just because a wallet happens to be on testnet.
 */
export function useAggregatedVaultStats(): AggregatedVaultStats {
  const tight = useVaultPage(getStrategyVaultAddress(MEZO_MAINNET_ID, "tight"));
  const medium = useVaultPage(getStrategyVaultAddress(MEZO_MAINNET_ID, "medium"));
  const wide = useVaultPage(getStrategyVaultAddress(MEZO_MAINNET_ID, "wide"));

  const rebalanceCounts = [tight.rebalanceCount, medium.rebalanceCount, wide.rebalanceCount].map(
    (c) => (c === undefined ? undefined : Number(c)),
  );

  return {
    tvlMusd: sumDefined([tight.tvlMusd, medium.tvlMusd, wide.tvlMusd]),
    feesMusd: sumDefined([tight.feesMusd, medium.feesMusd, wide.feesMusd]),
    rebalanceCount: sumDefined(rebalanceCounts),
  };
}
