import { formatUnits } from "viem";

export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): number {
  if (sqrtPriceX96 === BigInt(0)) return 0;
  const sqrtPrice = Number(sqrtPriceX96) / Math.pow(2, 96);
  const rawPrice = sqrtPrice * sqrtPrice;
  return rawPrice * Math.pow(10, decimals0 - decimals1);
}

export function tickToPrice(
  tick: number,
  decimals0: number,
  decimals1: number,
): number {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

export function formatPrice(price: number, symbol = ""): string {
  if (price === 0) return "0";
  let formatted: string;
  if (price < 0.00001) {
    formatted = price.toExponential(4);
  } else if (price < 1) {
    formatted = price.toFixed(6);
  } else if (price < 10000) {
    formatted = price.toLocaleString("en-US", { maximumFractionDigits: 4 });
  } else {
    formatted = price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return symbol ? `${formatted} ${symbol}` : formatted;
}

export function formatDisplayNumber(num: number, displayDecimals = 6): string {
  if (!isFinite(num)) return "—";
  if (num === 0) return "0";
  const abs = Math.abs(num);
  if (abs < 0.000001) return "< 0.000001";
  if (abs < 1) return num.toFixed(displayDecimals);
  if (abs < 1000)
    return num.toLocaleString("en-US", {
      maximumFractionDigits: displayDecimals,
    });
  return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  displayDecimals = 6,
): string {
  return formatDisplayNumber(
    parseFloat(formatUnits(amount, decimals)),
    displayDecimals,
  );
}

export function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export const MEZO_TESTNET_ID = 31611;
export const MEZO_MAINNET_ID = 31612;

export function explorerTxUrl(chainId: number, txHash: string): string {
  const base =
    chainId === MEZO_MAINNET_ID
      ? "https://explorer.mezo.org"
      : "https://explorer.test.mezo.org";
  return `${base}/tx/${txHash}`;
}

/**
 * Whether token0 is MUSD. Prefers the vault's actual token0 symbol (ground truth,
 * since token0/token1 ordering depends on the deployed token addresses, not just
 * the chain). Falls back to the chain convention below only while the symbol is
 * still loading:
 * Testnet (31611): token0 = MUSD, token1 = BTC.
 * Mainnet (31612): token0 = BTC, token1 = MUSD.
 * Defaults to the testnet convention when chainId is unknown/unconnected.
 */
export function isMusdToken0(
  chainId: number | undefined,
  symbol0?: string,
): boolean {
  if (symbol0 !== undefined) return symbol0 === "MUSD";
  return chainId !== MEZO_MAINNET_ID;
}

export function formatBps(bps: bigint | number): string {
  const n = typeof bps === "bigint" ? Number(bps) : bps;
  return `${(n / 100).toFixed(2)}%`;
}

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10000 - slippageBps)) / BigInt(10000);
}

export const STRATEGY_LABELS: Record<number, string> = {
  0: "Tight",
  1: "Medium",
  2: "Wide",
};

export const STRATEGY_DESCRIPTIONS: Record<number, string> = {
  0: "Narrow ±600 tick range — higher fee density, more frequent rebalancing",
  1: "Balanced ±1000 tick range — moderate fees, moderate rebalancing",
  2: "Wide ±2000 tick range — lower fee density, infrequent rebalancing",
};

export const STRATEGY_COLORS: Record<number, string> = {
  0: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  1: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  2: "text-blue-400 bg-blue-400/10 border-blue-400/20",
};

export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

/** Converts a token0-denominated human amount into its MUSD equivalent, using `price` = token1 amount per 1 token0 (as returned by tickToPrice/sqrtPriceX96ToPrice, decimal-adjusted, human units). */
export function toMusdFromToken0(
  amountToken0: number,
  price: number,
  isToken0Musd: boolean,
): number {
  return isToken0Musd ? amountToken0 : amountToken0 * price;
}

/** Combines fee0 + fee1 (human amounts) into a single MUSD figure, using `price` = token1 amount per 1 token0 (as returned by tickToPrice/sqrtPriceX96ToPrice, decimal-adjusted, human units). Returns undefined if `price` is unavailable (<= 0), rather than silently dropping the fee1 contribution. */
export function combineFeesToMusd(
  fee0: number,
  fee1: number,
  price: number,
  isToken0Musd: boolean,
): number | undefined {
  if (isToken0Musd) {
    if (price <= 0) return undefined;
    return fee0 + fee1 / price;
  }
  return fee0 * price + fee1;
}

const SECONDS_PER_YEAR = 31_536_000;
/**
 * Beyond this magnitude, a compounded short-window estimate is more likely a
 * sampling artifact (a BTC/MUSD price swing mismarked as yield, a single
 * anomalous block) than real, projectable yield. Show "insufficient data"
 * instead of a specific misleading number. Chosen to comfortably admit a
 * legitimately high APY on a small, young, fee-heavy vault while rejecting
 * the 4-5 digit values that a compounded 1-2%/day price move produces.
 */
const MAX_SANE_APY_PERCENT = 1000;
const MIN_SANE_APY_PERCENT = -90;

export interface ApySample {
  /** Unix seconds. */
  timestamp: number;
  /** Per-share value, converted to MUSD using this sample's own pool price. */
  shareValueMusd: number;
  /** Vault TVL at this sample, in any unit consistent across all samples (used only as a relative weight). */
  tvl: number;
}

/**
 * Trailing APY from a series of vault snapshots, per vaults.fyi's
 * methodology: pairwise growth ratios between CONSECUTIVE samples are
 * averaged, weighted by each pair's smaller TVL (a conservative choice that
 * avoids inflating yield during large inflows), then the resulting average
 * per-interval rate is compounded at that same cadence to annualize:
 * APY = (1 + rate)^(year/interval) - 1.
 *
 * This is far more robust to one anomalous sample (e.g. a single large swap
 * briefly moving price) than comparing just two window endpoints, since that
 * sample only ever contributes one of many pairwise comparisons. It does
 * NOT fully protect against a genuine sustained price trend across the whole
 * window — compounding any real short-window return to a full year is
 * inherently explosive — so the result is additionally bounded to a sane
 * display range (see MAX/MIN_SANE_APY_PERCENT) as a final backstop.
 *
 * Callers must convert each sample's share price (denominated in token0
 * units, e.g. BTC on mainnet) to MUSD via toMusdFromToken0 using THAT
 * sample's own pool price before calling this — see toMusdFromToken0's
 * doc comment for why an unconverted ratio would conflate real return with
 * token0/token1 price movement.
 *
 * `samples` must be sorted ascending by timestamp and contain at least 2 entries.
 */
export function computeTrailingApy(samples: ApySample[]): number | undefined {
  if (samples.length < 2) return undefined;

  let weightedRatioSum = 0;
  let weightSum = 0;
  let intervalSecondsSum = 0;
  let intervalCount = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (prev.shareValueMusd <= 0) continue;
    const ratio = cur.shareValueMusd / prev.shareValueMusd;
    if (!isFinite(ratio)) continue;
    const weight = Math.min(prev.tvl, cur.tvl);
    if (weight <= 0) continue;

    weightedRatioSum += ratio * weight;
    weightSum += weight;
    intervalSecondsSum += cur.timestamp - prev.timestamp;
    intervalCount += 1;
  }

  if (weightSum <= 0 || intervalCount === 0) return undefined;

  const avgRate = weightedRatioSum / weightSum - 1;
  if (avgRate <= -1) return undefined;

  const avgIntervalSeconds = intervalSecondsSum / intervalCount;
  if (avgIntervalSeconds <= 0) return undefined;

  const periodsPerYear = SECONDS_PER_YEAR / avgIntervalSeconds;
  const apy = (Math.pow(1 + avgRate, periodsPerYear) - 1) * 100;
  if (
    !isFinite(apy) ||
    apy > MAX_SANE_APY_PERCENT ||
    apy < MIN_SANE_APY_PERCENT
  )
    return undefined;
  console.log("computeTrailingApy", { avgRate, periodsPerYear, apy });
  return apy;
}
