"use client";

import { Reveal } from "./Reveal";

export function FinalCTA() {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-5 py-16 sm:py-24">
      <Reveal>
        <div className="glass text-center px-6 py-14 sm:py-20" style={{ borderRadius: "var(--r-xl)" }}>
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight" style={{ color: "var(--text)" }}>
            Put your liquidity on autopilot.
          </h2>
          <p className="mt-3 text-base sm:text-lg max-w-xl mx-auto" style={{ color: "var(--text-2)" }}>
            Deposit MUSD or BTC and let the keeper bot handle rebalancing, compounding, and
            range management for you.
          </p>
          <a
            href="/vault"
            className="tap btn-red rounded-2xl px-7 h-12 inline-flex items-center text-[15px] font-semibold mt-8"
          >
            Launch App
          </a>
        </div>
      </Reveal>
    </section>
  );
}
