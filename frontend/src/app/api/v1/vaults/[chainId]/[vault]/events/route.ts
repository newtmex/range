import { apiRoute } from "@/server/utils/response";
import { vaultRouteParamsSchema } from "@/server/utils/validation";
import { subgraphRequest } from "@/server/clients/subgraph";
import { getCache } from "@/server/cache";
import { getVaultEvents } from "@/server/services/events";

export const GET = apiRoute({
  route: "vault.events",
  params: vaultRouteParamsSchema,
  cacheSeconds: 30,
  handler: ({ chainId, vault }) =>
    getVaultEvents(subgraphRequest, getCache(), chainId, vault),
});
