import "server-only";

import { createPublicClient, http, type PublicClient } from "viem";
import {
  getChain,
  mezoMainnet,
  mezoTestnet,
  type SupportedChainId,
} from "@/lib/chains";
import { serverEnv } from "../config/env";

// RPC client construction lives here, apart from the services that use it, so
// services can take clients as arguments (testable with stubs) while routes
// wire in these defaults.

export interface RpcClients {
  /** Live node — current state, block headers. */
  live: PublicClient;
  /**
   * Archive node — eth_call at historical blocks. Falls back to `live` when no
   * archive URL is configured, in which case reads older than the public
   * nodes' pruning horizon revert and callers degrade gracefully.
   */
  archive: PublicClient;
}

function liveUrl(chainId: SupportedChainId): string {
  if (chainId === mezoMainnet.id) {
    // Keyed endpoint when configured; the chain definition's public keyless
    // endpoint otherwise.
    return serverEnv.MEZO_RPC_URL ?? mezoMainnet.rpcUrls.default.http[0];
  }
  return mezoTestnet.rpcUrls.default.http[0];
}

function archiveUrl(chainId: SupportedChainId): string | undefined {
  return chainId === mezoMainnet.id
    ? serverEnv.MEZO_ARCHIVE_RPC_URL
    : serverEnv.MEZO_ARCHIVE_RPC_URL_TESTNET;
}

const clientsByChain = new Map<SupportedChainId, RpcClients>();

export function getRpcClients(chainId: SupportedChainId): RpcClients {
  const existing = clientsByChain.get(chainId);
  if (existing) return existing;

  const chain = getChain(chainId);
  const live = createPublicClient({ chain, transport: http(liveUrl(chainId)) });
  const archiveEndpoint = archiveUrl(chainId);
  const archive = archiveEndpoint
    ? createPublicClient({ chain, transport: http(archiveEndpoint) })
    : live;

  const clients: RpcClients = { live, archive };
  clientsByChain.set(chainId, clients);
  return clients;
}
