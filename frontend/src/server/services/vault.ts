import "server-only";

import type { PublicClient } from "viem";
import {
  VAULT_ABI,
  VAULT_LENS_ABI,
  ERC20_ABI,
  getVaultLensAddress,
} from "@/lib/contracts";
import type { SupportedChainId } from "@/lib/chains";
import type {
  VaultSummaryWire,
  VaultCoreWire,
  TokenInfoWire,
  VaultMetricsWire,
} from "@/lib/api/types";
import { logger, errorField } from "../logger";
import { getPoolState } from "./pool";

async function readVaultCore(
  client: PublicClient,
  chainId: SupportedChainId,
  vault: `0x${string}`,
): Promise<VaultCoreWire> {
  const lens = getVaultLensAddress(chainId);
  const read = <F extends "symbol" | "totalAssets" | "totalSupply" | "paused" | "performanceFeeBps" | "tokenId" | "token0" | "token1" | "decimals0" | "decimals1">(
    functionName: F,
  ) => client.readContract({ address: vault, abi: VAULT_ABI, functionName });

  const [
    symbol,
    totalAssets,
    totalSupply,
    sharePrice,
    paused,
    performanceFeeBps,
    tokenId,
    token0,
    token1,
    decimals0,
    decimals1,
  ] = await Promise.all([
    read("symbol"),
    read("totalAssets"),
    read("totalSupply"),
    client.readContract({
      address: lens,
      abi: VAULT_LENS_ABI,
      functionName: "sharePrice",
      args: [vault],
    }),
    read("paused"),
    read("performanceFeeBps"),
    read("tokenId"),
    read("token0"),
    read("token1"),
    read("decimals0"),
    read("decimals1"),
  ]);

  return {
    symbol: symbol as string,
    totalAssets: (totalAssets as bigint).toString(),
    totalSupply: (totalSupply as bigint).toString(),
    sharePrice: sharePrice.toString(),
    paused: paused as boolean,
    performanceFeeBps: (performanceFeeBps as bigint).toString(),
    tokenId: (tokenId as bigint).toString(),
    token0: token0 as `0x${string}`,
    token1: token1 as `0x${string}`,
    decimals0: decimals0 as number,
    decimals1: decimals1 as number,
  };
}

async function readTokenSymbols(
  client: PublicClient,
  token0: `0x${string}`,
  token1: `0x${string}`,
): Promise<TokenInfoWire> {
  const [symbol0, symbol1] = await Promise.all([
    client.readContract({ address: token0, abi: ERC20_ABI, functionName: "symbol" }),
    client.readContract({ address: token1, abi: ERC20_ABI, functionName: "symbol" }),
  ]);
  return { symbol0, symbol1 };
}

async function readMetrics(
  client: PublicClient,
  chainId: SupportedChainId,
  vault: `0x${string}`,
): Promise<VaultMetricsWire> {
  const m = await client.readContract({
    address: getVaultLensAddress(chainId),
    abi: VAULT_LENS_ABI,
    functionName: "getVaultMetrics",
    args: [vault],
  });
  return {
    tvl: m.tvl.toString(),
    tickLower: m.tickLower,
    tickUpper: m.tickUpper,
  };
}

/**
 * The consolidated per-vault read backing /summary: core vault state, token
 * symbols, pool state, and lens metrics. The core multicall must succeed (it
 * carries `initialized`, which gates everything else); the dependent sections
 * fail independently — one flaky lens read shouldn't blank the whole page, so
 * failed sections come back null with a flag in `errors`.
 */
export async function getVaultSummary(
  client: PublicClient,
  chainId: SupportedChainId,
  vault: `0x${string}`,
): Promise<VaultSummaryWire> {
  const core = await readVaultCore(client, chainId, vault);
  const initialized = core.tokenId !== "0";

  const [tokens, pool, metrics] = await Promise.allSettled([
    readTokenSymbols(client, core.token0, core.token1),
    initialized ? getPoolState(client, chainId, vault) : Promise.resolve(null),
    initialized ? readMetrics(client, chainId, vault) : Promise.resolve(null),
  ]);

  const errors: VaultSummaryWire["errors"] = {};
  const section = <T>(
    result: PromiseSettledResult<T | null>,
    name: keyof VaultSummaryWire["errors"],
  ): T | null => {
    if (result.status === "fulfilled") return result.value;
    errors[name] = true;
    logger.warn("summary section failed", {
      upstream: "rpc",
      chainId,
      vault,
      section: name,
      error: errorField(result.reason),
    });
    return null;
  };

  return {
    vault: core,
    initialized,
    tokens: section(tokens, "tokens"),
    pool: section(pool, "pool"),
    metrics: section(metrics, "metrics"),
    errors,
  };
}
