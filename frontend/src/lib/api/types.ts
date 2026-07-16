// Wire types shared between the /api/v1 route handlers and the frontend
// hooks. BigInt values cross the wire as decimal strings (JSON has no bigint);
// hooks re-hydrate them at the boundary so components keep seeing `bigint`.

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiEnvelope<T> = ApiOk<T> | ApiErrorBody;

// ── /vaults/[chainId]/[vault]/summary ────────────────────────────────────────

export interface VaultCoreWire {
  symbol: string;
  totalAssets: string;
  totalSupply: string;
  sharePrice: string;
  paused: boolean;
  performanceFeeBps: string;
  tokenId: string;
  token0: `0x${string}`;
  token1: `0x${string}`;
  decimals0: number;
  decimals1: number;
}

export interface TokenInfoWire {
  symbol0: string;
  symbol1: string;
}

export interface PoolStateWire {
  sqrtPriceX96: string;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  isOutOfRange: boolean;
}

export interface VaultMetricsWire {
  tvl: string;
  tickLower: number;
  tickUpper: number;
}

export interface VaultSummaryWire {
  vault: VaultCoreWire;
  initialized: boolean;
  /** Null while the section is unavailable — uninitialized vault or failed read. */
  tokens: TokenInfoWire | null;
  pool: PoolStateWire | null;
  metrics: VaultMetricsWire | null;
  /** Sections whose upstream read failed (as opposed to being not applicable). */
  errors: {
    tokens?: boolean;
    pool?: boolean;
    metrics?: boolean;
  };
}

// ── /vaults/[chainId]/[vault]/events ─────────────────────────────────────────

export interface RebalanceEventWire {
  blockNumber: string;
  txHash: `0x${string}`;
  timestamp: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
}

export interface VaultEventsWire {
  rebalances: RebalanceEventWire[];
  rebalanceCount: number;
  totalFee0: string;
  totalFee1: string;
  firstEventTimestamp: number | null;
}

// ── /vaults/[chainId]/[vault]/apy ────────────────────────────────────────────

export interface VaultApyWire {
  apy1d: number | null;
  apy7d: number | null;
  apy30d: number | null;
}

// ── /vaults/[chainId]/[vault]/user/[account] ─────────────────────────────────

export interface UserPositionWire {
  shares: string;
  maxRedeem: string;
  balance0: string;
  balance1: string;
  allowance0: string;
  allowance1: string;
  /** convertToAssets(shares) — null when the account holds no shares. */
  assetValue: string | null;
}
