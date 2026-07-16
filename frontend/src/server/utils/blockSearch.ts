import "server-only";

import type { PublicClient } from "viem";

/**
 * Binary-searches for the earliest block whose timestamp is >= targetTimestamp.
 * Block timestamps are monotonic non-decreasing, so this is well-defined.
 * Block headers remain available on pruned nodes even when historical state
 * does not, so this is safe against the live (non-archive) client.
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
