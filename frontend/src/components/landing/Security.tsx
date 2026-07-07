"use client";

import { Lock, Clock, Timer, UserCog, PauseCircle, ShieldAlert } from "lucide-react";
import { Reveal } from "./Reveal";

const MITIGATIONS = [
  {
    icon: Lock,
    title: "Reentrancy Guards",
    description:
      "OpenZeppelin's ReentrancyGuard protects every fund-moving function: deposit, withdraw, redeem, and rebalance.",
  },
  {
    icon: Clock,
    title: "TWAP-Anchored Pricing",
    description:
      "All deposits and rebalance ranges are anchored to a 5-minute TWAP and revert if the spot price deviates more than 200 ticks.",
  },
  {
    icon: Timer,
    title: "Timelocked Fee Changes",
    description: "Performance fee changes are queued behind a 2-day timelock and hard-capped at 10%.",
  },
  {
    icon: UserCog,
    title: "Two-Step Ownership",
    description:
      "Ownership transfers require both a proposal and an explicit acceptance, preventing accidental handoffs.",
  },
  {
    icon: PauseCircle,
    title: "Emergency Pause",
    description: "The owner can halt all deposits, withdrawals, and rebalances instantly if something goes wrong.",
  },
  {
    icon: ShieldAlert,
    title: "Inflation-Attack Resistant",
    description:
      "1,000 dead shares are burned on the first deposit, neutralizing the classic ERC-4626 first-depositor inflation attack.",
  },
];

export function Security() {
  return (
    <section id="security" className="max-w-5xl mx-auto px-4 sm:px-5 py-16 sm:py-24">
      <Reveal className="max-w-xl">
        <span className="label">Security &amp; Trust</span>
        <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: "var(--text)" }}>
          Built with security-first architecture
        </h2>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {MITIGATIONS.map((m, i) => {
          const Icon = m.icon;
          return (
            <Reveal key={m.title} delay={i * 0.06}>
              <div className="card h-full p-5 sm:p-6">
                <span
                  className="flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0"
                  style={{ background: "var(--surface)" }}
                >
                  <Icon className="w-5 h-5" style={{ color: "var(--text-2)" }} />
                </span>
                <h3 className="mt-4 font-semibold text-[15px]" style={{ color: "var(--text)" }}>
                  {m.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
                  {m.description}
                </p>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={0.1} className="mt-6 text-center">
        <a
          href="https://github.com/MananSinghal123/mezo-rebalance"
          target="_blank"
          rel="noreferrer"
          className="tap link-muted text-sm"
        >
          Contracts are open-source and verifiable on GitHub →
        </a>
      </Reveal>
    </section>
  );
}
