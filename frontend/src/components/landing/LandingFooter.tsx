"use client";

import { Github, BookOpen, Compass } from "lucide-react";
import { Footer } from "@/components/ui/footer";

const FOOTER_LINKS = [
  { label: "GitHub", href: "https://github.com/MananSinghal123/mezo-rebalance", icon: Github },
  { label: "Docs", href: "https://mezo.org/docs", icon: BookOpen },
  { label: "Explorer", href: "https://explorer.mezo.org", icon: Compass },
];

export function LandingFooter() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 pt-12 sm:pt-16 pb-2">
      <div
        className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pb-6"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {FOOTER_LINKS.map((l) => {
          const Icon = l.icon;
          return (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="tap link-muted flex items-center gap-1.5 text-sm font-medium"
            >
              <Icon className="w-4 h-4" />
              {l.label}
            </a>
          );
        })}
      </div>
      <div className="pt-6">
        <Footer />
      </div>
    </div>
  );
}
