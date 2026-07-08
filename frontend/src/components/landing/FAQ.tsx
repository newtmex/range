"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Reveal } from "./Reveal";

const EASE = [0.16, 1, 0.3, 1] as const;

const FAQS = [
  {
    question: "What is RebalancerVault?",
    answer:
      "RebalancerVault is an automated concentrated-liquidity vault for Mezo's Uniswap V3-compatible DEX. You deposit tokens and receive ERC-4626 vault shares; an off-chain keeper bot monitors pool prices and rebalances the LP position back into range automatically, compounding fees continuously.",
  },
  {
    question: "Which assets can I deposit?",
    answer:
      "The vault accepts MUSD or BTC — deposit either side and the vault handles the rest, including any TWAP-derived conversion needed to align the position's token ratio.",
  },
  {
    question: "How is the performance fee charged?",
    answer:
      "A 10% performance fee is taken only from collected trading fees during a rebalance — never from your deposited principal. Fee changes are gated behind a 2-day timelock and hard-capped at 10%.",
  },
  {
    question: "What happens if I withdraw while a rebalance is pending?",
    answer:
      "A same-block guard prevents deposits and withdrawals from executing in the same block as a rebalance, so your transaction simply lands in the next block rather than colliding with keeper activity.",
  },
  {
    question:
      "What's the difference between the Tight, Medium, and Wide strategies?",
    answer:
      "They set how narrow the LP range is around the current price. Tight ranges capture more fees per dollar deposited but rebalance more often; Wide ranges rebalance less often but capture fewer fees per dollar. Medium balances the two.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();

  return (
    <section id="faq" className="max-w-5xl mx-auto px-4 sm:px-5 py-16 sm:py-24">
      <Reveal className="max-w-xl">
        <span className="label">FAQ</span>
        <h2
          className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight"
          style={{ color: "var(--text)" }}
        >
          Frequently asked questions
        </h2>
      </Reveal>

      <div className="mt-10 max-w-2xl space-y-3">
        {FAQS.map((faq, i) => {
          const isOpen = openIndex === i;
          return (
            <Reveal key={faq.question} delay={i * 0.05}>
              <div className="card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="tap w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span
                    className="font-semibold text-[15px]"
                    style={{ color: "var(--text)" }}
                  >
                    {faq.question}
                  </span>
                  <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.25,
                      ease: EASE,
                    }}
                    className="flex-shrink-0"
                  >
                    <ChevronDown
                      className="w-4 h-4"
                      style={{ color: "var(--text-3)" }}
                    />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        duration: reduceMotion ? 0 : 0.3,
                        ease: EASE,
                      }}
                      style={{ overflow: "hidden" }}
                    >
                      <p
                        className="px-5 pb-5 text-sm leading-relaxed"
                        style={{ color: "var(--text-2)" }}
                      >
                        {faq.answer}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
