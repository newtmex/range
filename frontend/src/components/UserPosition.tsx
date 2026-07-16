"use client";

import { formatTokenAmount } from "@/lib/utils";

interface Props {
  shares?: bigint;
  /** convertToAssets(shares), served by the user-position endpoint. */
  assetValue?: bigint;
  symbol0?: string;
  decimals0?: number;
  isConnected: boolean;
}

export function UserPosition({
  shares,
  assetValue,
  symbol0 = "TOKEN0",
  decimals0 = 18,
  isConnected,
}: Props) {
  const hasShares = shares !== undefined && shares > BigInt(0);

  if (!isConnected || !hasShares) return null;

  return (
    <div
      className="rounded-[20px] p-5 space-y-3 animate-in"
      style={{
        background:
          "linear-gradient(155deg, var(--red-bg) 0%, #fff 70%)",
        border: "1px solid var(--red-border)",
        boxShadow: "var(--shadow-glow)",
      }}
    >
      <span className="label" style={{ color: "var(--red)" }}>
        Your Deposit
      </span>

      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p
            className="mono text-[26px] leading-none font-bold truncate"
            style={{ color: "var(--text)" }}
          >
            {assetValue !== undefined
              ? formatTokenAmount(assetValue, decimals0, 8)
              : "—"}
          </p>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-2)" }}>
            {symbol0} equivalent
          </p>
        </div>
        <div className="text-right">
          <p className="mono text-sm" style={{ color: "var(--text-2)" }}>
            {formatTokenAmount(shares, decimals0, 6)}
          </p>
          <p className="label mt-0.5">Shares</p>
        </div>
      </div>
    </div>
  );
}
