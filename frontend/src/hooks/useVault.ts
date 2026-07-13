"use client";

import {
  useReadContracts,
  useReadContract,
  useAccount,
  useChainId,
} from "wagmi";
import {
  VAULT_ABI,
  VAULT_LENS_ABI,
  ERC20_ABI,
  getVaultLensAddress,
} from "@/lib/contracts";

export function useVaultState(vaultAddress: `0x${string}`) {
  const chainId = useChainId();
  const vaultLensAddress = getVaultLensAddress(chainId);

  const results = useReadContracts({
    contracts: [
      { address: vaultAddress, abi: VAULT_ABI, functionName: "symbol" },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "totalAssets" },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "totalSupply" },
      {
        address: vaultLensAddress,
        abi: VAULT_LENS_ABI,
        functionName: "sharePrice",
        args: [vaultAddress],
      },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "paused" },
      {
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "performanceFeeBps",
      },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "tokenId" },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "token0" },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "token1" },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "decimals0" },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "decimals1" },
    ],
    query: { refetchInterval: 10_000 },
  });

  const data = results.data;

  const tokenId = data?.[6]?.result as bigint | undefined;
  const initialized = tokenId !== undefined && tokenId !== BigInt(0);

  return {
    // "We expect data and don't have it yet" rather than the query's own
    // isLoading: a query that has been enabled but hasn't started fetching
    // reports isLoading:false for a frame, which is long enough for the stats
    // fed from here to flash their empty state before the first result lands.
    isLoading: data === undefined && !results.isError,
    isError: results.isError,
    vaultSymbol: (data?.[0]?.result as string | undefined) ?? "mREBAL",
    totalAssets: data?.[1]?.result as bigint | undefined,
    totalSupply: data?.[2]?.result as bigint | undefined,
    sharePrice: data?.[3]?.result as bigint | undefined,
    paused: data?.[4]?.result as boolean | undefined,
    performanceFeeBps: data?.[5]?.result as bigint | undefined,
    tokenId,
    initialized,
    token0Address: data?.[7]?.result as `0x${string}` | undefined,
    token1Address: data?.[8]?.result as `0x${string}` | undefined,
    decimals0: data?.[9]?.result as number | undefined,
    decimals1: data?.[10]?.result as number | undefined,
  };
}

export function usePoolState(
  vaultAddress: `0x${string}`,
  initialized: boolean,
) {
  const chainId = useChainId();
  const vaultLensAddress = getVaultLensAddress(chainId);

  const poolState = useReadContract({
    address: vaultLensAddress,
    abi: VAULT_LENS_ABI,
    functionName: "getPoolState",
    args: [vaultAddress],
    query: { enabled: initialized, refetchInterval: 5_000 },
  });

  const position = useReadContract({
    address: vaultLensAddress,
    abi: VAULT_LENS_ABI,
    functionName: "getPosition",
    args: [vaultAddress],
    query: { enabled: initialized, refetchInterval: 10_000 },
  });

  const outOfRange = useReadContract({
    address: vaultLensAddress,
    abi: VAULT_LENS_ABI,
    functionName: "isOutOfRange",
    args: [vaultAddress],
    query: { enabled: initialized, refetchInterval: 5_000 },
  });

  // getPoolState has two separate named outputs (not a single tuple), so viem
  // decodes it as a positional array [sqrtPriceX96, tick] rather than an object.
  const poolData = poolState.data as [bigint, number] | undefined;
  const posData = position.data as
    | {
        token0: string;
        token1: string;
        tickSpacing: number;
        tickLower: number;
        tickUpper: number;
        liquidity: bigint;
      }
    | undefined;

  const isError = poolState.isError || position.isError || outOfRange.isError;

  return {
    sqrtPriceX96: poolData?.[0],
    currentTick: poolData?.[1],
    tickLower: posData?.tickLower,
    tickUpper: posData?.tickUpper,
    liquidity: posData?.liquidity,
    isOutOfRange: outOfRange.data as boolean | undefined,
    // These reads are gated on `initialized`, which the vault multicall has to
    // resolve first — so "loading" here means "the vault has a position and we
    // haven't read it yet". When the vault turns out to be uninitialized the
    // queries never run, and the stats fed from here correctly settle empty
    // rather than spinning forever. Callers must additionally fold in the
    // vault's own loading state, since until that resolves we don't yet know
    // whether to expect a position at all.
    isLoading: initialized && !isError && (!poolData || !posData),
    isError,
  };
}

export function useVaultMetrics(
  vaultAddress: `0x${string}`,
  initialized: boolean,
) {
  const chainId = useChainId();
  const vaultLensAddress = getVaultLensAddress(chainId);

  const result = useReadContract({
    address: vaultLensAddress,
    abi: VAULT_LENS_ABI,
    functionName: "getVaultMetrics",
    args: [vaultAddress],
    query: { enabled: initialized, refetchInterval: 15_000 },
  });

  // rebalanceCount / totalFees0Earned / totalFees1Earned were removed from the
  // on-chain getVaultMetrics; those analytics are now derived from event logs
  // (see useVaultEvents). This hook only surfaces the live on-chain metrics.
  const data = result.data as
    | {
        tvl: bigint;
        tickLower: number;
        tickUpper: number;
      }
    | undefined;

  return {
    tvl: data?.tvl,
    tickLower: data?.tickLower,
    tickUpper: data?.tickUpper,
    // Same `initialized` gate as usePoolState — see the note there.
    isLoading: initialized && data === undefined && !result.isError,
    isError: result.isError,
  };
}

export function useTokenInfo(
  token0Address: `0x${string}` | undefined,
  token1Address: `0x${string}` | undefined,
) {
  const enabled = !!(token0Address && token1Address);

  const results = useReadContracts({
    contracts: [
      { address: token0Address, abi: ERC20_ABI, functionName: "symbol" },
      { address: token1Address, abi: ERC20_ABI, functionName: "symbol" },
    ],
    query: { enabled },
  });

  return {
    symbol0: results.data?.[0]?.result as string | undefined,
    symbol1: results.data?.[1]?.result as string | undefined,
    // Which of the two tokens is MUSD is inferred from symbol0, and until that
    // arrives isMusdToken0() falls back to a chain-based guess. Any stat printed
    // in MUSD therefore has to treat the symbols as a source it waits on —
    // otherwise a wrong guess renders a real number under the wrong
    // denomination, then silently flips once the symbols land.
    isLoading: enabled && results.data === undefined && !results.isError,
    isError: results.isError,
  };
}

export function useUserPosition(
  vaultAddress: `0x${string}`,
  token0Address: `0x${string}` | undefined,
  token1Address: `0x${string}` | undefined,
  _decimals0: number | undefined,
  _decimals1: number | undefined,
) {
  const { address } = useAccount();

  const results = useReadContracts({
    contracts: [
      {
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
      {
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "maxRedeem",
        args: address ? [address] : undefined,
      },
      {
        address: token0Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
      {
        address: token1Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
      {
        address: token0Address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: address ? [address, vaultAddress] : undefined,
      },
      {
        address: token1Address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: address ? [address, vaultAddress] : undefined,
      },
    ],
    query: {
      enabled: !!(address && token0Address && token1Address),
      refetchInterval: 5_000,
    },
  });

  return {
    shares: results.data?.[0]?.result as bigint | undefined,
    maxRedeem: results.data?.[1]?.result as bigint | undefined,
    balance0: results.data?.[2]?.result as bigint | undefined,
    balance1: results.data?.[3]?.result as bigint | undefined,
    allowance0: results.data?.[4]?.result as bigint | undefined,
    allowance1: results.data?.[5]?.result as bigint | undefined,
    isLoading: results.isLoading,
  };
}
