/**
 * A single asynchronously-fetched value, carrying its own status.
 *
 * The vault stats are assembled from five independent sources (the vault
 * multicall, the pool/metrics lens reads, the events subgraph, and the APY
 * computation) that resolve at very different speeds. A single page-wide
 * `isLoading` flag therefore can't describe them: the moment the fastest source
 * settles, every stat still in flight would fall back to a placeholder. Each
 * stat tracks its own status instead.
 *
 * `success` with `value: undefined` is the *empty* state — the fetch resolved,
 * there is simply nothing to show (an uninitialized vault has no tick range; a
 * vault with no activity has no APY). That is meaningfully different from
 * `loading` (nothing to show *yet*) and from `error` (we don't know what there
 * is to show), and it's the only one of the three that should render a dash.
 */
export type AsyncStat<T> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; value: T | undefined };

/** The state of one source feeding a stat. */
export interface AsyncSource {
  isLoading: boolean;
  isError: boolean;
}

/**
 * Merges the sources feeding a derived stat: loading if any is still loading,
 * errored if any failed. TVL, for example, needs both the vault's `totalAssets`
 * and the pool's current tick, so it is only settled once both are.
 */
export function combine(...sources: AsyncSource[]): AsyncSource {
  return {
    isLoading: sources.some((s) => s.isLoading),
    isError: sources.some((s) => s.isError),
  };
}

/**
 * Resolves a stat from its source(s) and a thunk producing its value.
 *
 * An available value always wins over the source status, which is what keeps
 * the tiles from flickering: background polls (every 5–30s here) and failed
 * refetches both leave the last good value in place rather than dropping the
 * tile back to a skeleton or an error. A stat only reports `loading` or `error`
 * when it has nothing better to show — i.e. on the initial fetch.
 */
export function resolveStat<T>(
  source: AsyncSource,
  value: () => T | undefined,
): AsyncStat<T> {
  const resolved = value();
  if (resolved !== undefined) return { status: "success", value: resolved };
  if (source.isLoading) return { status: "loading" };
  if (source.isError) return { status: "error" };
  return { status: "success", value: undefined };
}

/** True when a stat has settled on an actual value (not loading, error, or empty). */
export function hasValue<T>(
  stat: AsyncStat<T>,
): stat is { status: "success"; value: T } {
  return stat.status === "success" && stat.value !== undefined;
}
