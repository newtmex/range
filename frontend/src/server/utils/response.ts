import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { logger, errorField } from "../logger";

// Standard response envelope: { ok: true, data } | { ok: false, error }.
// BigInts serialize as decimal strings. Error messages stay terse and never
// echo upstream URLs or raw provider errors to the client.

/** Thrown by services for conditions with a well-defined client-facing meaning. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body, bigintReplacer), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface ApiRouteConfig<P, T> {
  /** Route name for logs, e.g. "vault.summary". */
  route: string;
  /** Zod schema for the (awaited) dynamic route params. */
  params: z.ZodType<P>;
  /**
   * CDN cache lifetime (Cache-Control: s-maxage) for successful responses.
   * Omit for responses that must not be shared across users.
   */
  cacheSeconds?: number;
  handler: (params: P, req: NextRequest) => Promise<T>;
}

/**
 * Wraps a route handler with the shared concerns: same-origin check, param
 * validation, error→envelope mapping, and structured duration logging — so the
 * route files themselves stay declarative.
 */
export function apiRoute<P, T>(config: ApiRouteConfig<P, T>) {
  return async (
    req: NextRequest,
    ctx: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    const started = Date.now();
    let status = 200;
    try {
      // Browser-initiated cross-site calls carry a foreign Origin; reject them
      // so other sites can't ride on our upstream quotas. Same-origin fetches
      // and origin-less requests (curl, server-to-server) pass.
      const origin = req.headers.get("origin");
      const host = req.headers.get("host");
      if (origin && host && new URL(origin).host !== host) {
        throw new ApiError(403, "FORBIDDEN_ORIGIN", "Cross-origin requests are not allowed");
      }

      const rawParams = await ctx.params;
      const parsed = config.params.safeParse(rawParams);
      if (!parsed.success) {
        throw new ApiError(400, "INVALID_PARAMS", z.prettifyError(parsed.error));
      }

      const data = await config.handler(parsed.data, req);
      const headers: Record<string, string> = {};
      if (config.cacheSeconds !== undefined) {
        headers["cache-control"] =
          `public, s-maxage=${config.cacheSeconds}, stale-while-revalidate=${config.cacheSeconds * 2}`;
      }
      return jsonResponse({ ok: true, data }, 200, headers);
    } catch (err) {
      const apiErr =
        err instanceof ApiError
          ? err
          : // Anything unrecognized at this level is an upstream (RPC/subgraph)
            // failure or a bug; either way the client just needs "it failed".
            new ApiError(502, "UPSTREAM_ERROR", "Upstream request failed");
      status = apiErr.status;
      if (!(err instanceof ApiError)) {
        logger.error("route unhandled error", {
          route: config.route,
          error: errorField(err),
        });
      }
      return jsonResponse(
        { ok: false, error: { code: apiErr.code, message: apiErr.message } },
        status,
      );
    } finally {
      logger.info("request", {
        route: config.route,
        status,
        durationMs: Date.now() - started,
      });
    }
  };
}
