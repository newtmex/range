"use client";

/**
 * Loading placeholder. Sized by the caller so it occupies roughly the same box
 * as the value it stands in for, which keeps tiles from resizing when real data
 * lands. `pulse` is defined in globals.css.
 */
export function Skeleton({ className = "h-5 w-20" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block rounded-md ${className}`}
      style={{
        background: "var(--surface)",
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}
