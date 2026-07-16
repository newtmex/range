"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";
import { fetchApi } from "@/lib/api/client";
import type { VaultSummaryWire, UserPositionWire } from "@/lib/api/types";

// All chain reads live behind the /api/v1 backend now. The vault page's cheap
// per-vault reads (state, tokens, pool, metrics) are consolidated into one
// /summary endpoint; the hooks below keep their original shapes but are
// selectors over a single shared TanStack Query — identical queryKeys dedupe
// to one request per poll regardless of how many hooks subscribe.

const SUMMARY_POLL_MS = 5_000;
const USER_POLL_MS = 5_000;

function big(value: string): bigint;
function big(value: string | null | undefined): bigint | undefined;
function big(value: string | null | undefined): bigint | undefined {
  return value === null || value === undefined ? undefined : BigInt(value);
}

function useVaultSummary(vaultAddress: `0x${string}`) {
  const chainId = useChainId();
  return useQuery({
    queryKey: ["vault-summary", chainId, vaultAddress],
    queryFn: () =>
      fetchApi<VaultSummaryWire>(
        `/api/v1/vaults/${chainId}/${vaultAddress}/summary`,
      ),
    refetchInterval: SUMMARY_POLL_MS,
    retry: false,
  });
}

export function useVaultState(vaultAddress: `0x${string}`) {
  const summary = useVaultSummary(vaultAddress);
  const v = summary.data?.vault;

  const tokenId = v ? big(v.tokenId) : undefined;

  return {
    // "We expect data and don't have it yet" rather than the query's own
    // isLoading — a failed poll keeps the last data on screen (react-query
    // retains `data` across refetch errors), so only a dataless state counts
    // as loading.
    isLoading: summary.data === undefined && !summary.isError,
    isError: summary.isError,
    vaultSymbol: v?.symbol ?? "mREBAL",
    totalAssets: v ? big(v.totalAssets) : undefined,
    totalSupply: v ? big(v.totalSupply) : undefined,
    sharePrice: v ? big(v.sharePrice) : undefined,
    paused: v?.paused,
    performanceFeeBps: v ? big(v.performanceFeeBps) : undefined,
    tokenId,
    initialized: summary.data?.initialized ?? false,
    token0Address: v?.token0,
    token1Address: v?.token1,
    decimals0: v?.decimals0,
    decimals1: v?.decimals1,
  };
}

export function usePoolState(
  vaultAddress: `0x${string}`,
  initialized: boolean,
) {
  const summary = useVaultSummary(vaultAddress);
  const pool = summary.data?.pool;
  const isError = summary.isError || summary.data?.errors.pool === true;

  return {
    sqrtPriceX96: pool ? big(pool.sqrtPriceX96) : undefined,
    currentTick: pool?.currentTick,
    tickLower: pool?.tickLower,
    tickUpper: pool?.tickUpper,
    liquidity: pool ? big(pool.liquidity) : undefined,
    isOutOfRange: pool?.isOutOfRange,
    // Pool data only exists for initialized vaults — when the vault turns out
    // to be uninitialized the section is null by design and the stats fed from
    // here correctly settle empty rather than spinning forever. Callers must
    // additionally fold in the vault's own loading state, since until that
    // resolves we don't yet know whether to expect a position at all.
    isLoading: initialized && !isError && !pool,
    isError,
  };
}

export function useVaultMetrics(
  vaultAddress: `0x${string}`,
  initialized: boolean,
) {
  const summary = useVaultSummary(vaultAddress);
  const metrics = summary.data?.metrics;
  const isError = summary.isError || summary.data?.errors.metrics === true;

  return {
    tvl: metrics ? big(metrics.tvl) : undefined,
    tickLower: metrics?.tickLower,
    tickUpper: metrics?.tickUpper,
    // Same `initialized` gate as usePoolState — see the note there.
    isLoading: initialized && !isError && !metrics,
    isError,
  };
}

export function useTokenInfo(vaultAddress: `0x${string}`) {
  const summary = useVaultSummary(vaultAddress);
  const tokens = summary.data?.tokens;
  const isError = summary.isError || summary.data?.errors.tokens === true;

  return {
    symbol0: tokens?.symbol0,
    symbol1: tokens?.symbol1,
    // Which of the two tokens is MUSD is inferred from symbol0, and until that
    // arrives isMusdToken0() falls back to a chain-based guess. Any stat printed
    // in MUSD therefore has to treat the symbols as a source it waits on —
    // otherwise a wrong guess renders a real number under the wrong
    // denomination, then silently flips once the symbols land.
    isLoading: !isError && !tokens,
    isError,
  };
}

export function useUserPosition(
  vaultAddress: `0x${string}`,
  token0Address: `0x${string}` | undefined,
  token1Address: `0x${string}` | undefined,
  _decimals0: number | undefined,
  _decimals1: number | undefined,
) {
  const { address } = useAccount();
  const chainId = useChainId();

  // The backend resolves token addresses from the vault itself; the token
  // params only gate the fetch (as they did when this hook read the chain
  // directly) so we don't poll for positions before the vault has loaded.
  const enabled = !!(address && token0Address && token1Address);

  const query = useQuery({
    queryKey: ["vault-user", chainId, vaultAddress, address],
    queryFn: () =>
      fetchApi<UserPositionWire>(
        `/api/v1/vaults/${chainId}/${vaultAddress}/user/${address}`,
      ),
    enabled,
    refetchInterval: USER_POLL_MS,
    retry: false,
  });

  const d = query.data;

  return {
    shares: d ? big(d.shares) : undefined,
    maxRedeem: d ? big(d.maxRedeem) : undefined,
    balance0: d ? big(d.balance0) : undefined,
    balance1: d ? big(d.balance1) : undefined,
    allowance0: d ? big(d.allowance0) : undefined,
    allowance1: d ? big(d.allowance1) : undefined,
    /** convertToAssets(shares) — undefined until fetched or when no shares. */
    assetValue: d ? big(d.assetValue) : undefined,
    isLoading: query.isLoading,
  };
}
