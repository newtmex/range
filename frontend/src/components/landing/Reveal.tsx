"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

const EASE = [0.16, 1, 0.3, 1] as const;

const variants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

interface RevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

/**
 * Fades + slides content up once it scrolls into view. Collapses to an instant
 * (zero-duration) transition under prefers-reduced-motion rather than branching
 * to a plain `<div>` — `useReducedMotion()` can't resolve during SSR (no
 * `window`), so branching the rendered element type caused a server/client
 * hydration mismatch for any visitor whose browser prefers reduced motion.
 * Always rendering the same `motion.div` with the same `initial` variant keeps
 * the server- and client-rendered markup identical; only the transition timing
 * (which never affects the initial static style) varies.
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={variants}
      transition={{ duration: reduceMotion ? 0 : 0.45, delay: reduceMotion ? 0 : delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
