import { apiRoute } from "@/server/utils/response";
import { vaultRouteParamsSchema } from "@/server/utils/validation";
import { getRpcClients } from "@/server/clients/rpc";
import { getVaultSummary } from "@/server/services/vault";

// Consolidated vault read: core state + token symbols + pool + metrics.
// Polled by the vault page; s-maxage lets the CDN collapse polling across
// visitors into one origin hit per window.
export const GET = apiRoute({
  route: "vault.summary",
  params: vaultRouteParamsSchema,
  cacheSeconds: 5,
  handler: ({ chainId, vault }) =>
    getVaultSummary(getRpcClients(chainId).live, chainId, vault),
});
