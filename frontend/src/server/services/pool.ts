import "server-only";

import type { PublicClient } from "viem";
import { VAULT_LENS_ABI, getVaultLensAddress } from "@/lib/contracts";
import type { SupportedChainId } from "@/lib/chains";
import type { PoolStateWire } from "@/lib/api/types";

/**
 * Reads the vault's pool state (price/tick), current position, and range
 * status from the lens. Callers must only invoke this for initialized vaults —
 * the lens reads revert before the vault has opened a position.
 */
export async function getPoolState(
  client: PublicClient,
  chainId: SupportedChainId,
  vault: `0x${string}`,
): Promise<PoolStateWire> {
  const lens = getVaultLensAddress(chainId);

  const [poolState, position, isOutOfRange] = await Promise.all([
    client.readContract({
      address: lens,
      abi: VAULT_LENS_ABI,
      functionName: "getPoolState",
      args: [vault],
    }),
    client.readContract({
      address: lens,
      abi: VAULT_LENS_ABI,
      functionName: "getPosition",
      args: [vault],
    }),
    client.readContract({
      address: lens,
      abi: VAULT_LENS_ABI,
      functionName: "isOutOfRange",
      args: [vault],
    }),
  ]);

  // getPoolState has two separate named outputs (not a single tuple), so viem
  // decodes it as a positional array [sqrtPriceX96, tick].
  const [sqrtPriceX96, tick] = poolState;

  return {
    sqrtPriceX96: sqrtPriceX96.toString(),
    currentTick: tick,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: position.liquidity.toString(),
    isOutOfRange,
  };
}
