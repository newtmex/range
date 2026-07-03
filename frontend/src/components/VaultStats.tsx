"use client";

import { formatDisplayNumber, formatBps } from "@/lib/utils";

interface VaultStatsProps {
  tvlMusd?: number;
  sharePriceMusd?: number;
  feesMusd?: number;
  symMusd?: string;
  performanceFeeBps?: bigint;
  paused?: boolean;
  isLoading: boolean;
  apy?: number;
  rebalanceCount?: bigint | number;
  tickLower?: number;
  tickUpper?: number;
}

function Skeleton() {
  return (
    <span
      className="inline-block h-5 w-20 rounded-md"
      style={{ background: "var(--surface)", animation: "pulse 1.5s ease-in-out infinite" }}
    />
  );
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

export function VaultStats({
  tvlMusd,
  sharePriceMusd,
  feesMusd,
  symMusd = "MUSD",
  performanceFeeBps,
  paused,
  isLoading,
  apy,
  rebalanceCount,
  tickLower,
  tickUpper,
}: VaultStatsProps) {
  const tiles: { label: string; value: React.ReactNode; highlight?: boolean }[] = [
    {
      label: "TVL",
      value:
        tvlMusd !== undefined
          ? `${formatDisplayNumber(tvlMusd, 6)} ${symMusd}`
          : "—",
    },
    {
      label: "APY",
      value: apy !== undefined ? `${apy.toFixed(2)}%` : "—",
      highlight: apy !== undefined,
    },
    {
      label: "Fees Earned",
      value:
        feesMusd !== undefined
          ? `${formatDisplayNumber(feesMusd, 6)} ${symMusd}`
          : "—",
    },
    {
      label: "Status",
      value:
        paused === undefined ? (
          "—"
        ) : paused ? (
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
    },
    {
      label: "Range",
      value:
        tickLower !== undefined && tickUpper !== undefined
          ? `${tickLower} / ${tickUpper}`
          : "—",
    },
    {
      label: "Share Price",
      value:
        sharePriceMusd !== undefined
          ? `${formatDisplayNumber(sharePriceMusd, 8)} ${symMusd}`
          : "—",
    },
    {
      label: "Rebalances",
      value: rebalanceCount !== undefined ? String(rebalanceCount) : "—",
    },
    {
      label: "Perf Fee",
      value: performanceFeeBps !== undefined ? formatBps(performanceFeeBps) : "—",
    },
  ];

  return (
    <div className="card overflow-hidden animate-in">
      <div
        className="grid grid-cols-2 sm:grid-cols-4"
        style={{ gap: 1, background: "var(--border-2)" }}
      >
        {tiles.map((t, i) => (
          <div key={i} style={{ background: "var(--surface-2)" }}>
            <Stat
              label={t.label}
              highlight={t.highlight}
              value={isLoading ? <Skeleton /> : t.value}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
