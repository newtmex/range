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
import {
  computeAPY,
  isMusdToken0,
  tickToPrice,
  toMusdFromToken0,
  combineFeesToMusd,
} from "@/lib/utils";

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

  console.log(vault, pool, metrics, tokens, user, events, "vault page data");
  const sym0 = tokens.symbol0 ?? "TOKEN0";
  const sym1 = tokens.symbol1 ?? "TOKEN1";
  const d0 = vault.decimals0 ?? 18;
  const d1 = vault.decimals1 ?? 18;
  const symMusd = isToken0Musd ? sym0 : sym1;

  const price =
    pool.currentTick !== undefined
      ? tickToPrice(pool.currentTick, d0, d1)
      : undefined;


  const totalFee0 = metrics.fees0Earned ?? events.totalFee0;
  const totalFee1 = metrics.fees1Earned ?? events.totalFee1;

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

  const apy = computeAPY(feesMusd, tvlMusd, events.firstEventTimestamp);

  return {
    isConnected,
    sym0,
    sym1,
    symMusd,
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
    rebalanceCount: metrics.rebalanceCount ?? events.rebalanceCount,
    tickLower: metrics.tickLower ?? pool.tickLower,
    tickUpper: metrics.tickUpper ?? pool.tickUpper,
  };
}
