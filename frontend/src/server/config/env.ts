import "server-only";

import { z } from "zod";

// Server-only configuration. None of these use the NEXT_PUBLIC_ prefix, so
// none of them can leak into the client bundle. Every URL here is optional —
// each has a graceful fallback (public RPC / feature degrades) — but when
// present it must be a well-formed URL, and a malformed value fails loudly at
// boot instead of producing confusing upstream errors at request time.

/** Treats unset/empty as undefined, otherwise trims and requires a valid URL. */
const optionalUrl = z.preprocess(
  (v) => {
    if (typeof v !== "string") return undefined;
    const trimmed = v.trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z.url().optional(),
);

const envSchema = z.object({
  /** Keyed mainnet live RPC. Falls back to the public keyless endpoint when unset. */
  MEZO_RPC_URL: optionalUrl,
  /**
   * Archive RPC endpoints for historical state reads (trailing APY windows).
   * Public Mezo nodes prune historical state (~half a day), so eth_call at
   * older blocks reverts without these; when unset the APY service falls back
   * to the live client and longer windows simply resolve to "no data".
   */
  MEZO_ARCHIVE_RPC_URL: optionalUrl,
  MEZO_ARCHIVE_RPC_URL_TESTNET: optionalUrl,
  /** Goldsky subgraph query endpoints. Events/APY endpoints 503 when unset. */
  SUBGRAPH_URL_TESTNET: optionalUrl,
  SUBGRAPH_URL_MAINNET: optionalUrl,
});

export type ServerEnv = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // z.prettifyError names each offending variable; never echo values.
  throw new Error(`Invalid server environment:\n${z.prettifyError(parsed.error)}`);
}

export const serverEnv: ServerEnv = parsed.data;
