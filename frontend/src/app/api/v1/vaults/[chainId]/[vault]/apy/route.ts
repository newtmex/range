import { apiRoute } from "@/server/utils/response";
import { vaultRouteParamsSchema } from "@/server/utils/validation";
import { getRpcClients } from "@/server/clients/rpc";
import { subgraphRequest } from "@/server/clients/subgraph";
import { getCache } from "@/server/cache";
import { getVaultApy } from "@/server/services/apy";

export const GET = apiRoute({
  route: "vault.apy",
  params: vaultRouteParamsSchema,
  cacheSeconds: 300,
  handler: ({ chainId, vault }) =>
    getVaultApy(getRpcClients(chainId), subgraphRequest, getCache(), chainId, vault),
});
