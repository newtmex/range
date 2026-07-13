"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createPublicClient, defineChain, http, type PublicClient } from "viem";

export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.test.mezo.org"] },
  },
  blockExplorers: {
    default: {
      name: "Mezo Explorer",
      url: "https://explorer.test.mezo.org",
    },
  },
  testnet: true,
});

export const mezoMainnet = defineChain({
  id: 31612,
  name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_MEZO_RPC_URL ||
          "https://mainnet.mezo.public.validationcloud.io",
        "https://mezo.drpc.org",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Mezo Explorer",
      url: "https://explorer.mezo.org",
    },
  },
});

// Archive RPC endpoints, keyed by chain id. The default public Mezo nodes prune
// historical state (~half a day), so `eth_call` at older blocks reverts. Point
// these at an archive node to serve the historical share-price reads that the
// trailing APY windows depend on. Optional — when unset, callers fall back to
// the live public client and the longer windows simply won't have data.
const ARCHIVE_RPC_URLS: Record<number, string | undefined> = {
  [mezoTestnet.id]: process.env.NEXT_PUBLIC_MEZO_ARCHIVE_RPC_URL_TESTNET,
  [mezoMainnet.id]: process.env.NEXT_PUBLIC_MEZO_ARCHIVE_RPC_URL,
};

/**
 * Returns a viem PublicClient pointed at the archive RPC for `chainId`, or
 * `undefined` when no archive URL is configured for that chain. Intended for
 * read-only historical `eth_call`s (e.g. share price at past blocks); callers
 * should fall back to the live client when this returns `undefined`.
 */
export function getArchiveClient(
  chainId: number | undefined,
): PublicClient | undefined {
  if (chainId === undefined) return undefined;
  const url = ARCHIVE_RPC_URLS[chainId];
  if (!url) return undefined;
  const chain = chainId === mezoMainnet.id ? mezoMainnet : mezoTestnet;
  return createPublicClient({ chain, transport: http(url) });
}

export const wagmiConfig = getDefaultConfig({
  appName: "Mezo Rebalancer",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [mezoMainnet, mezoTestnet],
  ssr: true,
});
