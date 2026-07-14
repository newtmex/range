"use client";

import { useAccount, useChainId } from "wagmi";
import { formatUnits } from "viem";
import {
  useVaultState,
  usePoolState,
  useTokenInfo,
  useUserPosition,
  useVaultMetrics,
} from "@/hooks/useVault";
import { useVaultEvents } from "@/hooks/useVaultEvents";
import { useVaultApy } from "@/hooks/useVaultApy";
import {
  isMusdToken0,
  tickToPrice,
  toMusdFromToken0,
  combineFeesToMusd,
} from "@/lib/utils";
import { combine, resolveStat, type AsyncSource } from "@/lib/async";
import type { VaultStatsData } from "@/components/VaultStats";

export function useVaultPage(vaultAddress: `0x${string}`) {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  const vault = useVaultState(vaultAddress);
  const pool = usePoolState(vaultAddress, vault.initialized);
  const metrics = useVaultMetrics(vaultAddress, vault.initialized);
  const tokens = useTokenInfo(vault.token0Address, vault.token1Address);
  const isToken0Musd = isMusdToken0(chainId, tokens.symbol0);
  const user = useUserPosition(
    vaultAddress,
    vault.token0Address,
    vault.token1Address,
    vault.decimals0,
    vault.decimals1,
  );
  const events = useVaultEvents(vaultAddress);
  const vaultApy = useVaultApy(
    vaultAddress,
    chainId,
    events.firstEventTimestamp,
    events.isLoading,
    events.isError,
  );

  const sym0 = tokens.symbol0 ?? "TOKEN0";
  const sym1 = tokens.symbol1 ?? "TOKEN1";
  const d0 = vault.decimals0 ?? 18;
  const d1 = vault.decimals1 ?? 18;
  const symMusd = isToken0Musd ? sym0 : sym1;

  const price =
    pool.currentTick !== undefined
      ? tickToPrice(pool.currentTick, d0, d1)
      : undefined;


  // Fees earned are event-sourced (on-chain counters were removed).
  const totalFee0 = events.totalFee0;
  const totalFee1 = events.totalFee1;

  const tvlMusd =
    vault.totalAssets !== undefined && price !== undefined
      ? toMusdFromToken0(
          Number(formatUnits(vault.totalAssets, d0)),
          price,
          isToken0Musd,
        )
      : undefined;

  const sharePriceMusd =
    vault.sharePrice !== undefined && price !== undefined
      ? toMusdFromToken0(
          Number(formatUnits(vault.sharePrice, d0)),
          price,
          isToken0Musd,
        )
      : undefined;

  const feesMusd =
    totalFee0 !== undefined && totalFee1 !== undefined && price !== undefined
      ? combineFeesToMusd(
          Number(formatUnits(totalFee0, d0)),
          Number(formatUnits(totalFee1, d1)),
          price,
          isToken0Musd,
        )
      : undefined;

  // Trailing share-price APY (vaults.fyi methodology, TVL-weighted). Collapse
  // the three windows into the single figure VaultStats renders, preferring the
  // most stable window that's actually available — longer windows need archive
  // history that public RPCs may have pruned, so fall back toward the 1d window.
  const apy = vaultApy.apy30d ?? vaultApy.apy7d ?? vaultApy.apy1d;

  const tickLower = metrics.tickLower ?? pool.tickLower;
  const tickUpper = metrics.tickUpper ?? pool.tickUpper;

  // Each stat waits on exactly the sources it is derived from, so a slow source
  // can't drag a settled stat back to a skeleton and a fast one can't push an
  // unsettled stat into rendering a fallback. `price` (and therefore every
  // MUSD-denominated figure) comes from the pool, which is itself gated on the
  // vault — hence the vault source appears in those combines too.
  const vaultSrc: AsyncSource = { isLoading: vault.isLoading, isError: vault.isError };
  const poolSrc: AsyncSource = combine(vaultSrc, {
    isLoading: pool.isLoading,
    isError: pool.isError,
  });
  const metricsSrc: AsyncSource = combine(vaultSrc, {
    isLoading: metrics.isLoading,
    isError: metrics.isError,
  });
  const tokensSrc: AsyncSource = combine(vaultSrc, {
    isLoading: tokens.isLoading,
    isError: tokens.isError,
  });
  const eventsSrc: AsyncSource = { isLoading: events.isLoading, isError: events.isError };
  const apySrc: AsyncSource = { isLoading: vaultApy.isLoading, isError: vaultApy.isError };

  // The MUSD figures are only meaningful once the symbols identify which token
  // is MUSD, so they wait on tokens as well as on the numbers themselves.
  const musdSrc = combine(poolSrc, tokensSrc);

  const stats: VaultStatsData = {
    tvl: resolveStat(musdSrc, () => tvlMusd),
    apy: resolveStat(apySrc, () => apy),
    fees: resolveStat(combine(musdSrc, eventsSrc), () => feesMusd),
    paused: resolveStat(vaultSrc, () => vault.paused),
    sharePrice: resolveStat(musdSrc, () => sharePriceMusd),
    rebalanceCount: resolveStat(eventsSrc, () => events.rebalanceCount),
    performanceFeeBps: resolveStat(vaultSrc, () => vault.performanceFeeBps),
    range: resolveStat(combine(metricsSrc, poolSrc), () =>
      tickLower !== undefined && tickUpper !== undefined
        ? { lower: tickLower, upper: tickUpper }
        : undefined,
    ),
  };

  return {
    stats,
    isConnected,
    sym0,
    sym1,
    symMusd,
    price,
    // Undefined until the token symbols identify which token is MUSD — see the
    // note in useTokenInfo. Consumers gate MUSD rendering on this being set,
    // so a chain-based guess never prints a number under the wrong denomination.
    isToken0Musd: tokens.symbol0 !== undefined ? isToken0Musd : undefined,
    vaultSymbol: vault.vaultSymbol,
    d0,
    d1,
    vault,
    pool,
    user,
    events,
    apy,
    tvlMusd,
    feesMusd,
    sharePriceMusd,
    rebalanceCount: events.rebalanceCount,
    tickLower,
    tickUpper,
  };
}
