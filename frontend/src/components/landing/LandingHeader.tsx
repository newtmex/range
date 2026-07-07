"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/header";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it Works", href: "#how-it-works" },
  { label: "Security", href: "#security" },
  { label: "FAQ", href: "#faq" },
];

export function LandingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="glass-header sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 sm:px-5 h-16 flex items-center justify-between gap-3">
        <Logo href="/" />

        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="tap text-sm font-medium px-3 h-9 flex items-center rounded-xl transition-colors"
              style={{ color: "var(--text-2)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-2)")}
            >
              {l.label}
            </a>
          ))}
          <a
            href="/vault"
            className="tap btn-red rounded-xl px-4 h-9 flex items-center text-sm font-semibold ml-2"
          >
            Launch App
          </a>
        </div>

        <div className="flex md:hidden items-center gap-2">
          <a
            href="/vault"
            className="tap btn-red rounded-xl px-3.5 h-10 flex items-center text-sm font-semibold"
          >
            Launch App
          </a>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="tap btn-ghost flex items-center justify-center w-11 h-11 rounded-2xl cursor-pointer"
          >
            <Menu className="w-5 h-5" style={{ color: "var(--text)" }} />
          </button>
        </div>
      </div>

      {mounted &&
        menuOpen &&
        createPortal(<MobileNav onClose={() => setMenuOpen(false)} />, document.body)}
    </header>
  );
}

function MobileNav({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] md:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ background: "rgba(13,13,18,0.45)", animation: "scrim-in 220ms ease both" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="absolute right-0 top-0 bottom-0 w-[86%] max-w-[360px] flex flex-col rounded-l-[24px] overflow-hidden"
        style={{
          background: "var(--surface-2)",
          boxShadow: "-24px 0 60px rgba(16,24,40,0.18)",
          animation: "sheet-in 300ms cubic-bezier(0.16,1,0.3,1) both",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div
          className="flex items-center justify-between h-16 px-5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="font-bold text-base tracking-tight" style={{ color: "var(--text)" }}>
            Menu
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="tap btn-ghost flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer"
          >
            <X className="w-5 h-5" style={{ color: "var(--text)" }} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 py-5">
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid var(--border)", background: "#fff" }}
          >
            {NAV_LINKS.map((l, i) => (
              <a
                key={l.label}
                href={l.href}
                onClick={onClose}
                className="tap flex items-center px-4 min-h-[54px] text-[15px] font-medium transition-colors active:opacity-70"
                style={{
                  color: "var(--text)",
                  borderTop: i === 0 ? "none" : "1px solid var(--border-2)",
                }}
              >
                {l.label}
              </a>
            ))}
          </div>
          <a
            href="/vault"
            onClick={onClose}
            className="tap btn-red rounded-2xl h-12 flex items-center justify-center text-sm font-semibold mt-4"
          >
            Launch App
          </a>
        </nav>
      </div>
    </div>
  );
}
