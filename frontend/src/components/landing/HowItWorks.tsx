"use client";

import { Reveal } from "./Reveal";

const STEPS = [
  {
    title: "Deposit",
    description:
      "Deposit MUSD or BTC and mint vault shares representing your portion of the LP position.",
  },
  {
    title: "Keeper Monitors",
    description: "An off-chain keeper watches the pool price around the clock.",
  },
  {
    title: "Auto-Rebalance",
    description:
      "When price drifts out of range, the vault removes liquidity, compounds fees, and re-centers the position — atomically, on-chain.",
  },
  {
    title: "Withdraw Anytime",
    description: "Redeem your shares for the underlying tokens whenever you want. No lock-ups.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="max-w-5xl mx-auto px-4 sm:px-5 py-16 sm:py-24">
      <Reveal className="max-w-xl">
        <span className="label">How it Works</span>
        <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: "var(--text)" }}>
          Four steps to hands-free liquidity
        </h2>
      </Reveal>

      <div className="mt-12 relative grid grid-cols-1 lg:grid-cols-4 gap-8 lg:gap-6">
        <div
          className="hidden lg:block absolute top-6 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, var(--border), var(--border), transparent)" }}
          aria-hidden="true"
        />

        {STEPS.map((step, i) => (
          <Reveal key={step.title} delay={i * 0.12} className="relative">
            <div
              className="relative z-10 flex items-center justify-center w-12 h-12 rounded-2xl font-bold text-[15px]"
              style={{
                background: "var(--surface-2)",
                border: "1.5px solid var(--red-border)",
                color: "var(--red)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              {i + 1}
            </div>
            <h3 className="mt-4 font-semibold text-[15px]" style={{ color: "var(--text)" }}>
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
              {step.description}
            </p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
