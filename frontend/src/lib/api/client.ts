import type { ApiEnvelope } from "./types";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * Fetches an /api/v1 endpoint and unwraps the { ok, data } envelope, throwing
 * ApiRequestError on transport failures, non-2xx responses, or ok:false
 * envelopes — so callers (TanStack Query fetchers) only ever see payload data.
 */
export async function fetchApi<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch {
    throw new ApiRequestError("Network error", "NETWORK", 0);
  }

  let body: ApiEnvelope<T> | undefined;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // fall through to the generic error below
  }

  if (!body || !("ok" in body)) {
    throw new ApiRequestError(`Malformed response (${res.status})`, "MALFORMED", res.status);
  }
  if (!body.ok) {
    throw new ApiRequestError(body.error.message, body.error.code, res.status);
  }
  return body.data;
}
