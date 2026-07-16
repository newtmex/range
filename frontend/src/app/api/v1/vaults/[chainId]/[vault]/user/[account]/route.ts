import { apiRoute } from "@/server/utils/response";
import { userRouteParamsSchema } from "@/server/utils/validation";
import { getRpcClients } from "@/server/clients/rpc";
import { getUserPosition } from "@/server/services/user";

// Per-account data — deliberately no cacheSeconds, so responses are never
// shared through the CDN.
export const GET = apiRoute({
  route: "vault.user",
  params: userRouteParamsSchema,
  handler: ({ chainId, vault, account }) =>
    getUserPosition(getRpcClients(chainId).live, vault, account),
});
