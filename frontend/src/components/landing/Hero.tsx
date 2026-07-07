"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";

const EASE = [0.16, 1, 0.3, 1] as const;

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

export function Hero() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative overflow-hidden">
      <BackgroundBlob reduceMotion={!!reduceMotion} />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-5 pt-20 pb-24 sm:pt-28 sm:pb-32">
        <motion.div initial="hidden" animate="visible" variants={container} className="max-w-2xl">
          <motion.span
            variants={item}
            className="label inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
            style={{ background: "var(--red-bg)", color: "var(--red)", border: "1px solid var(--red-border)" }}
          >
            MUSD / BTC Automated Liquidity
          </motion.span>

          <motion.h1
            variants={item}
            className="mt-5 text-4xl sm:text-6xl font-bold tracking-tight leading-[1.08]"
            style={{ color: "var(--text)" }}
          >
            Automated liquidity,
            <br />
            always in range.
          </motion.h1>

          <motion.p variants={item} className="mt-5 text-base sm:text-lg max-w-xl" style={{ color: "var(--text-2)" }}>
            Deposit MUSD or BTC into an ERC-4626 vault. A keeper bot rebalances your
            position automatically, so you keep earning trading fees without managing
            a thing.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex flex-wrap items-center gap-3">
            <a href="/vault" className="tap btn-red rounded-2xl px-6 h-12 flex items-center text-[15px] font-semibold">
              Launch App
            </a>
            <a
              href="https://mezo.org/docs"
              target="_blank"
              rel="noreferrer"
              className="tap btn-ghost rounded-2xl px-6 h-12 flex items-center text-[15px] font-semibold"
            >
              Read the Docs
            </a>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function BackgroundBlob({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      aria-hidden="true"
      className="absolute -z-10 rounded-full"
      style={{
        width: 640,
        height: 640,
        top: -220,
        right: -160,
        background:
          "radial-gradient(circle, rgba(225,29,72,0.14), rgba(251,191,36,0.06) 55%, transparent 72%)",
        filter: "blur(60px)",
      }}
      animate={
        reduceMotion
          ? undefined
          : { x: [0, 24, -12, 0], y: [0, -18, 14, 0], scale: [1, 1.05, 0.98, 1] }
      }
      transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
