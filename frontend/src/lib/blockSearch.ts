import type { PublicClient } from "viem";

/**
 * Binary-searches for a contract's deployment block using eth_getCode
 * (empty bytecode before deployment, non-empty at/after it). O(log latest)
 * RPC calls — used instead of fromBlock:"earliest" because public RPCs cap
 * eth_getLogs to a bounded block range.
 */
export async function findDeploymentBlock(
  client: PublicClient,
  address: `0x${string}`,
  latest: bigint,
): Promise<bigint> {
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const code = await client.getCode({ address, blockNumber: mid });
    if (code && code !== "0x") {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }
  return lo;
}

/**
 * Binary-searches for the earliest block whose timestamp is >= targetTimestamp.
 * Block timestamps are monotonic non-decreasing, so this is well-defined.
 */
export async function findBlockAtTimestamp(
  client: PublicClient,
  targetTimestamp: bigint,
  latest: bigint,
): Promise<bigint> {
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (block.timestamp >= targetTimestamp) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }
  return lo;
}
