"use client";

import { formatDisplayNumber, formatBps } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { hasValue, type AsyncStat } from "@/lib/async";

/**
 * One status per stat, because they come from five sources that settle at very
 * different speeds. A single page-wide flag would let the tiles still in flight
 * render a fallback the moment the fastest source landed.
 */
export interface VaultStatsData {
  tvl: AsyncStat<number>;
  apy: AsyncStat<number>;
  fees: AsyncStat<number>;
  paused: AsyncStat<boolean>;
  range: AsyncStat<{ lower: number; upper: number }>;
  sharePrice: AsyncStat<number>;
  rebalanceCount: AsyncStat<number>;
  performanceFeeBps: AsyncStat<bigint>;
}

interface VaultStatsProps {
  stats: VaultStatsData;
  symMusd?: string;
}

/** Shown when a stat's fetch failed and there is no last-known value to fall back on. */
function Unavailable() {
  return (
    <span className="text-[13px] font-medium" style={{ color: "var(--error)" }}>
      Unavailable
    </span>
  );
}

/**
 * Renders a stat according to its own status: a skeleton while it is loading,
 * an error marker if it failed with nothing to show, a dash if it resolved to
 * genuinely no data, and the formatted value otherwise. `render` only ever runs
 * on a real value, so no tile can print a default or a fallback.
 */
function renderStat<T>(
  stat: AsyncStat<T>,
  render: (value: T) => React.ReactNode,
): React.ReactNode {
  if (stat.status === "loading") return <Skeleton />;
  if (stat.status === "error") return <Unavailable />;
  if (stat.value === undefined) return "—";
  return render(stat.value);
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 px-3.5 py-3 sm:px-4 sm:py-3.5">
      <span className="label">{label}</span>
      <span
        className="mono font-semibold text-[15px] sm:text-base"
        style={{ color: highlight ? "var(--red)" : "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}

export function VaultStats({ stats, symMusd = "MUSD" }: VaultStatsProps) {
  const tiles: { label: string; value: React.ReactNode; highlight?: boolean }[] = [
    {
      label: "TVL",
      value: renderStat(
        stats.tvl,
        (tvl) => `${formatDisplayNumber(tvl, 6)} ${symMusd}`,
      ),
    },
    {
      label: "APY",
      value: renderStat(stats.apy, (apy) => `${apy.toFixed(2)}%`),
      // Only tint the tile red once it actually holds a figure — a skeleton or
      // an error marker shouldn't be styled as if it were a yield.
      highlight: hasValue(stats.apy),
    },
    {
      label: "Fees Earned",
      value: renderStat(
        stats.fees,
        (fees) => `${formatDisplayNumber(fees, 6)} ${symMusd}`,
      ),
    },
    {
      label: "Status",
      value: renderStat(stats.paused, (paused) =>
        paused ? (
          <span style={{ color: "var(--error)" }}>Paused</span>
        ) : (
          <span className="flex items-center gap-1.5" style={{ color: "var(--green)" }}>
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: "var(--green)", boxShadow: "0 0 0 3px rgba(22,163,74,0.16)" }}
            />
            Active
          </span>
        ),
      ),
    },
    {
      label: "Range",
      value: renderStat(stats.range, (r) => `${r.lower} / ${r.upper}`),
    },
    {
      label: "Share Price",
      value: renderStat(
        stats.sharePrice,
        (price) => `${formatDisplayNumber(price, 8)} ${symMusd}`,
      ),
    },
    {
      label: "Rebalances",
      value: renderStat(stats.rebalanceCount, (count) => String(count)),
    },
    {
      label: "Perf Fee",
      value: renderStat(stats.performanceFeeBps, (bps) => formatBps(bps)),
    },
  ];

  return (
    <div className="card overflow-hidden animate-in">
      <div
        className="grid grid-cols-2 sm:grid-cols-4"
        style={{ gap: 1, background: "var(--border-2)" }}
      >
        {tiles.map((t) => (
          <div key={t.label} style={{ background: "var(--surface-2)" }}>
            <Stat label={t.label} highlight={t.highlight} value={t.value} />
          </div>
        ))}
      </div>
    </div>
  );
}
