"use client";

import { RefreshCw, SlidersHorizontal, Layers, ShieldCheck } from "lucide-react";
import { Reveal } from "./Reveal";

const FEATURES = [
  {
    icon: RefreshCw,
    title: "Automated Rebalancing",
    description:
      "An off-chain keeper bot monitors the pool 24/7 and rebalances your position in a single atomic transaction the moment price drifts out of range.",
  },
  {
    icon: SlidersHorizontal,
    title: "Choose Your Risk Profile",
    description:
      "Pick Tight, Medium, or Wide ranges — trade off fee capture against rebalance frequency to match your strategy.",
  },
  {
    icon: Layers,
    title: "ERC-4626 Vault Shares",
    description:
      "Deposits mint standard, composable vault shares. Non-custodial by design — you always control your withdrawal.",
  },
  {
    icon: ShieldCheck,
    title: "TWAP-Protected",
    description:
      "Deposits and rebalances are anchored to a 5-minute time-weighted average price, resistant to flash-loan manipulation.",
  },
];

export function Features() {
  return (
    <section id="features" className="max-w-5xl mx-auto px-4 sm:px-5 py-16 sm:py-24">
      <Reveal className="max-w-xl">
        <span className="label">Features</span>
        <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: "var(--text)" }}>
          Everything you need, nothing to manage
        </h2>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {FEATURES.map((f, i) => {
          const Icon = f.icon;
          return (
            <Reveal key={f.title} delay={i * 0.08}>
              <div
                className="glass h-full p-5 sm:p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]"
                style={{ borderRadius: "var(--r-lg)" }}
              >
                <span
                  className="flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0"
                  style={{ background: "var(--red-bg)", border: "1px solid var(--red-border)" }}
                >
                  <Icon className="w-5 h-5" style={{ color: "var(--red)" }} />
                </span>
                <h3 className="mt-4 font-semibold text-[15px]" style={{ color: "var(--text)" }}>
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
                  {f.description}
                </p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
