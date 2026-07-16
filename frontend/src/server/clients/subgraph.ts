import "server-only";

import { mezoMainnet, type SupportedChainId } from "@/lib/chains";
import { serverEnv } from "../config/env";
import { logger, errorField } from "../logger";
import { ApiError } from "../utils/response";

// Thin GraphQL transport for the Goldsky subgraph — no domain knowledge here;
// queries and response shaping belong to services/events.ts.

export type SubgraphRequest = <T>(
  chainId: SupportedChainId,
  query: string,
  variables: Record<string, unknown>,
) => Promise<T>;

function subgraphUrl(chainId: SupportedChainId): string | undefined {
  return chainId === mezoMainnet.id
    ? serverEnv.SUBGRAPH_URL_MAINNET
    : serverEnv.SUBGRAPH_URL_TESTNET;
}

export const subgraphRequest: SubgraphRequest = async <T>(
  chainId: SupportedChainId,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const url = subgraphUrl(chainId);
  if (!url) {
    throw new ApiError(
      503,
      "SUBGRAPH_NOT_CONFIGURED",
      `No subgraph configured for chain ${chainId}`,
    );
  }

  let json: { data?: T; errors?: unknown };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    json = (await res.json()) as { data?: T; errors?: unknown };
  } catch (err) {
    logger.error("subgraph request failed", {
      upstream: "subgraph",
      chainId,
      error: errorField(err),
    });
    throw new ApiError(502, "SUBGRAPH_ERROR", "Subgraph request failed");
  }

  if (json.errors || !json.data) {
    logger.error("subgraph query errors", {
      upstream: "subgraph",
      chainId,
      error: JSON.stringify(json.errors).slice(0, 500),
    });
    throw new ApiError(502, "SUBGRAPH_ERROR", "Subgraph query failed");
  }
  return json.data;
};
