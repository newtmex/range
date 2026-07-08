import { MEZO_TESTNET_ID, MEZO_MAINNET_ID } from "./utils";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const STRATEGY_META = {
  tight: {
    label: "Tight",
    description: "Narrow range, higher fees, more rebalances",
    enabled: true,
  },
  medium: {
    label: "Medium",
    description: "Balanced range and rebalance frequency",
    enabled: false,
  },
  wide: {
    label: "Wide",
    description: "Wide range, lower fees, fewer rebalances",
    enabled: false,
  },
} as const;

export type StrategyKey = keyof typeof STRATEGY_META;

export const ENABLED_STRATEGY_KEYS = (
  Object.keys(STRATEGY_META) as StrategyKey[]
).filter((key) => STRATEGY_META[key].enabled);

const STRATEGY_ADDRESSES: Record<number, Record<StrategyKey, `0x${string}`>> = {
  [MEZO_TESTNET_ID]: {
    tight: (process.env.NEXT_PUBLIC_VAULT_MUSD_BTC_TIGHT_TESTNET ||
      ZERO_ADDRESS) as `0x${string}`,
    medium: (process.env.NEXT_PUBLIC_VAULT_MUSD_BTC_MEDIUM_TESTNET ||
      ZERO_ADDRESS) as `0x${string}`,
    wide: (process.env.NEXT_PUBLIC_VAULT_MUSD_BTC_WIDE_TESTNET ||
      ZERO_ADDRESS) as `0x${string}`,
  },
  [MEZO_MAINNET_ID]: {
    tight: (process.env.NEXT_PUBLIC_VAULT_MUSD_BTC_TIGHT_MAINNET ||
      ZERO_ADDRESS) as `0x${string}`,
    medium: (process.env.NEXT_PUBLIC_VAULT_MUSD_BTC_MEDIUM_MAINNET ||
      ZERO_ADDRESS) as `0x${string}`,
    wide: (process.env.NEXT_PUBLIC_VAULT_MUSD_BTC_WIDE_MAINNET ||
      ZERO_ADDRESS) as `0x${string}`,
  },
};

/** Falls back to the testnet address when chainId is undefined or unrecognized. */
export function getStrategyVaultAddress(
  chainId: number | undefined,
  key: StrategyKey,
): `0x${string}` {
  const addresses =
    STRATEGY_ADDRESSES[chainId ?? MEZO_TESTNET_ID] ??
    STRATEGY_ADDRESSES[MEZO_TESTNET_ID];
  return addresses[key];
}

export const DEFAULT_STRATEGY: StrategyKey = "tight";

export function resolveStrategy(param: string | null): StrategyKey {
  if (
    (param === "medium" || param === "wide" || param === "tight") &&
    STRATEGY_META[param].enabled
  ) {
    return param;
  }
  return DEFAULT_STRATEGY;
}
