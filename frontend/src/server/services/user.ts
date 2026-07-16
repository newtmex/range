import "server-only";

import type { PublicClient } from "viem";
import { VAULT_ABI, ERC20_ABI } from "@/lib/contracts";
import type { UserPositionWire } from "@/lib/api/types";

/**
 * Everything the UI shows about one account's relationship to one vault:
 * share balance (and its asset value), redeemable shares, wallet token
 * balances, and vault allowances. Per-account, so never CDN-cached.
 */
export async function getUserPosition(
  client: PublicClient,
  vault: `0x${string}`,
  account: `0x${string}`,
): Promise<UserPositionWire> {
  // Token addresses come from the vault itself rather than trusting client
  // input — two cheap reads that keep the endpoint's surface minimal.
  const [token0, token1] = await Promise.all([
    client.readContract({ address: vault, abi: VAULT_ABI, functionName: "token0" }),
    client.readContract({ address: vault, abi: VAULT_ABI, functionName: "token1" }),
  ]);

  const [shares, maxRedeem, balance0, balance1, allowance0, allowance1] =
    await Promise.all([
      client.readContract({
        address: vault,
        abi: VAULT_ABI,
        functionName: "balanceOf",
        args: [account],
      }),
      client.readContract({
        address: vault,
        abi: VAULT_ABI,
        functionName: "maxRedeem",
        args: [account],
      }),
      client.readContract({
        address: token0,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account],
      }),
      client.readContract({
        address: token1,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account],
      }),
      client.readContract({
        address: token0,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account, vault],
      }),
      client.readContract({
        address: token1,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account, vault],
      }),
    ]);

  const assetValue =
    shares > 0n
      ? await client.readContract({
          address: vault,
          abi: VAULT_ABI,
          functionName: "convertToAssets",
          args: [shares],
        })
      : null;

  return {
    shares: shares.toString(),
    maxRedeem: maxRedeem.toString(),
    balance0: balance0.toString(),
    balance1: balance1.toString(),
    allowance0: allowance0.toString(),
    allowance1: allowance1.toString(),
    assetValue: assetValue === null ? null : assetValue.toString(),
  };
}
