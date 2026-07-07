"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, animate } from "framer-motion";
import { useAggregatedVaultStats } from "@/hooks/useAggregatedVaultStats";
import { formatDisplayNumber } from "@/lib/utils";
import { Reveal } from "./Reveal";

const EASE = [0.16, 1, 0.3, 1] as const;

function formatMusdStat(n: number): string {
  return `${formatDisplayNumber(n, 2)} MUSD`;
}

function formatCountStat(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function CountUpStat({
  label,
  value,
  format,
}: {
  label: string;
  value: number | undefined;
  format: (n: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [display, setDisplay] = useState("0");
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || value === undefined || startedRef.current) return;
    startedRef.current = true;
    const controls = animate(0, value, {
      duration: 1.2,
      ease: EASE,
      onUpdate: (latest) => setDisplay(format(latest)),
    });
    return () => controls.stop();
  }, [inView, value, format]);

  return (
    <div ref={ref} className="card px-5 py-6 sm:px-6 sm:py-7 text-center">
      <span className="label">{label}</span>
      <div className="mono font-bold text-2xl sm:text-3xl mt-2" style={{ color: "var(--text)" }}>
        {value === undefined ? (
          <span
            className="inline-block h-8 w-24 rounded-md"
            style={{ background: "var(--surface)", animation: "pulse 1.5s ease-in-out infinite" }}
          />
        ) : (
          display
        )}
      </div>
    </div>
  );
}

export function Stats() {
  const { tvlMusd, feesMusd, rebalanceCount } = useAggregatedVaultStats();

  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-5 py-16 sm:py-24">
      <Reveal>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <CountUpStat label="Total Value Locked" value={tvlMusd} format={formatMusdStat} />
          <CountUpStat label="Total Fees Earned" value={feesMusd} format={formatMusdStat} />
          <CountUpStat label="Rebalances Executed" value={rebalanceCount} format={formatCountStat} />
          <div className="card px-5 py-6 sm:px-6 sm:py-7 text-center">
            <span className="label">Active Strategies</span>
            <div className="mono font-bold text-2xl sm:text-3xl mt-2" style={{ color: "var(--text)" }}>
              3
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
