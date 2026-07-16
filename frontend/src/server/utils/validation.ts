import "server-only";

import { z } from "zod";
import { isAddress } from "viem";
import { SUPPORTED_CHAIN_IDS, type SupportedChainId } from "@/lib/chains";
import {
  STRATEGY_META,
  getStrategyVaultAddress,
  type StrategyKey,
} from "@/lib/strategies";

export const chainIdSchema = z.coerce
  .number()
  .refine(
    (id): id is SupportedChainId =>
      (SUPPORTED_CHAIN_IDS as readonly number[]).includes(id),
    { message: "Unsupported chain id" },
  );

export const addressSchema = z
  .string()
  .refine(isAddress, { message: "Invalid address" })
  .transform((a) => a as `0x${string}`);

/** Known strategy vault addresses (lowercased) per chain, built once. */
const KNOWN_VAULTS: Record<number, Set<string>> = Object.fromEntries(
  SUPPORTED_CHAIN_IDS.map((chainId) => [
    chainId,
    new Set(
      (Object.keys(STRATEGY_META) as StrategyKey[]).map((key) =>
        getStrategyVaultAddress(chainId, key).toLowerCase(),
      ),
    ),
  ]),
);

/**
 * The vault param must be one of the configured strategy vaults — this keeps
 * the API from being usable as a generic lens over arbitrary contracts.
 */
export function isKnownVault(chainId: SupportedChainId, vault: `0x${string}`): boolean {
  return KNOWN_VAULTS[chainId]?.has(vault.toLowerCase()) ?? false;
}

export const vaultRouteParamsSchema = z
  .object({
    chainId: chainIdSchema,
    vault: addressSchema,
  })
  .refine((p) => isKnownVault(p.chainId, p.vault), {
    message: "Unknown vault",
  });

export const userRouteParamsSchema = z
  .object({
    chainId: chainIdSchema,
    vault: addressSchema,
    account: addressSchema,
  })
  .refine((p) => isKnownVault(p.chainId, p.vault), {
    message: "Unknown vault",
  });
