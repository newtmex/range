"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mezoMainnet, mezoTestnet } from "@/lib/chains";

// The wagmi transport only serves the transaction flow (deposit/withdraw
// previews, simulateContract, receipt watching) — all data reads go through
// the /api/v1 backend. The chain definitions carry only public keyless RPC
// endpoints, so nothing sensitive ships in the bundle; the keyed RPC and
// archive endpoints live server-side (src/server/config/env.ts).

export { mezoMainnet, mezoTestnet };

export const wagmiConfig = getDefaultConfig({
  appName: "Mezo Rebalancer",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [mezoMainnet, mezoTestnet],
  ssr: true,
});
