"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import type { VaultApyWire } from "@/lib/api/types";

// Trailing share-price APY (vaults.fyi methodology, MUSD-denominated). The
// whole pipeline — subgraph first-activity lookup, block binary-search, and
// the fan-out of historical eth_calls against the archive node — runs in the
// backend (src/server/services/apy.ts, where the methodology is documented)
// and is cached server-side, so every visitor shares one computation per TTL.

const APY_REFRESH_MS = 5 * 60 * 1000; // matches the server-side cache TTL

export interface VaultApy {
  /** Trailing 1-day APY, in percent. Most responsive to recent changes. */
  apy1d: number | undefined;
  /** Trailing 7-day APY, in percent. */
  apy7d: number | undefined;
  /** Trailing 30-day APY, in percent. Most stable, slowest to react. */
  apy30d: number | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function useVaultApy(
  vaultAddress: `0x${string}`,
  chainId: number | undefined,
): VaultApy {
  const query = useQuery({
    queryKey: ["vault-apy", chainId, vaultAddress],
    queryFn: () =>
      fetchApi<VaultApyWire>(`/api/v1/vaults/${chainId}/${vaultAddress}/apy`),
    enabled: chainId !== undefined,
    refetchInterval: APY_REFRESH_MS,
    staleTime: APY_REFRESH_MS,
    retry: false,
  });

  const d = query.data;

  return {
    apy1d: d?.apy1d ?? undefined,
    apy7d: d?.apy7d ?? undefined,
    apy30d: d?.apy30d ?? undefined,
    // Once a figure is on screen a failed refresh keeps it there (react-query
    // retains data across refetch errors) rather than blanking the tile.
    isLoading: query.data === undefined && !query.isError,
    isError: query.isError,
  };
}
