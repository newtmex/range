import { defineChain } from "viem";

// Chain definitions live here (not in config/wagmi.ts, which is a "use client"
// module) so the server-side RPC clients can share them. Only public, keyless
// RPC endpoints belong in these definitions — they ship in the client bundle.
// Keyed/paid endpoints are server-only (see src/server/config/env.ts).

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

export const SUPPORTED_CHAIN_IDS = [mezoTestnet.id, mezoMainnet.id] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export function getChain(chainId: SupportedChainId) {
  return chainId === mezoMainnet.id ? mezoMainnet : mezoTestnet;
}
