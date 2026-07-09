# Invariant Map

> Range (Rebalancer Vault) | 22 guards | 15 inferred | 5 not enforced on-chain

---

## 1. Enforced Guards (Reference)

Per-call preconditions. Heading IDs below (`G-N`) are anchor targets from x-ray.md attack surfaces.

#### G-1
`if (msg.sender != _s().owner) revert NotOwner()` · `RebalancerVaultUpgradeable.sol:143` · Confines all vault configuration (operator/guardian/strategy/adapter/fee/pause) to the single owner key.

#### G-2
`if (msg.sender != _s().operator) revert NotOperator()` · `RebalancerVaultUpgradeable.sol:148` · Restricts value-moving rebalance/collect/deployIdle flows to the keeper wallet.

#### G-3
`if (_s().paused) revert Paused()` · `RebalancerVaultUpgradeable.sol:153` · Emergency kill-switch gating deposit/mint/withdraw/redeem/rebalance/deployIdle.

#### G-4
`if (_s().tokenId == 0) revert NotInitialized()` · `RebalancerVaultUpgradeable.sol:158` · Blocks fee collection and rebalance before a position exists.

#### G-5
`if (assets > maxDeposit(receiver)) revert ExceedsMaxDeposit()` · `RebalancerVaultUpgradeable.sol:386` · `maxDeposit` returns 0 when paused or spot deviates from TWAP → couples deposits to the price-proximity oracle check.

#### G-6
`if (assets <= DEAD_SHARES) revert BelowMinDeposit()` · `RebalancerVaultUpgradeable.sol:398` · Ensures the first deposit exceeds the 1000 dead-share offset so `shares` cannot underflow to zero.

#### G-7
`if (block.number <= s.lastDepositBlock[owner_]) revert SameBlock()` · `RebalancerVaultUpgradeable.sol:452` · Same-block deposit+exit sandwich guard on withdraw/redeem (also line 530).

#### G-8
`if (finalIdle0 < assets) revert InsufficientToken0ForWithdraw(finalIdle0, assets)` · `RebalancerVaultUpgradeable.sol:516` · Guarantees the promised token0 amount is on hand before transfer.

#### G-9
`if (s.tokenId != 0) revert AlreadyInitialized()` · `RebalancerVaultUpgradeable.sol:683` · One-shot latch: position can be initialized only once.

#### G-10
`if (tickLower >= tickUpper) revert InvalidRange()` · `RebalancerVaultUpgradeable.sol:684` · Rejects degenerate/inverted initial ranges.

#### G-11
`if (newLiquidity == 0) revert NoLiquidityMinted()` · `RebalancerVaultUpgradeable.sol:703` · Rejects mints/increases that add no liquidity (also 906; `addedLiq==0` at 976).

#### G-12
`if (bps > 1000) revert FeeTooHigh()` · `RebalancerVaultUpgradeable.sol:1038` · Hard-caps the performance fee at 10% at proposal time.

#### G-13
`if (block.timestamp < s.feeChangeActiveAt) revert TimelockActive()` · `RebalancerVaultUpgradeable.sol:1049` · Enforces the 2-day timelock before a proposed fee/recipient takes effect.

#### G-14
`if (seconds_ < 60) revert TwapTooShort()` · `RebalancerVaultUpgradeable.sol:1066` · Floors the TWAP window so the oracle cannot be shrunk toward spot.

#### G-15
`if (ticks <= 0 || ticks > 1000) revert DeviationOutOfRange()` · `RebalancerVaultUpgradeable.sol:1071` · Bounds the max spot/TWAP deviation tolerance.

#### G-16
`if (bps > 500) revert SlippageTooHigh()` · `RebalancerVaultUpgradeable.sol:1076` · Caps configurable swap/mint slippage at 5%.

#### G-17
`if (token == s.token0 || token == s.token1) revert InvalidToken()` · `RebalancerVaultUpgradeable.sol:1057` · Prevents the owner sweep from draining the two vault assets.

#### G-18
`if (msg.sender != s.pendingOwner) revert NotPendingOwner()` · `RebalancerVaultUpgradeable.sol:992` · Second leg of two-step ownership handover.

#### G-19
`if (msg.sender != _s().guardian) revert NotGuardian()` · `RebalancerVaultUpgradeable.sol:1011` · Restricts the emergency pause path to the guardian (the factory).

#### G-20
`if (deviation > int256(uint256(int256(maxTwapDeviationTicks)))) revert PriceDeviatedFromTwap()` · `OracleLib.sol:47` · The core anti-manipulation guard: spot must sit within N ticks of the TWAP on every user/keeper action.

#### G-21
`if (sqrtPriceX96 == 0) revert InvalidPoolPrice()` · `VaultMath.sol:25` · Rejects a zero TWAP sqrt price before token1→token0 valuation.

#### G-22
`if (vaultFor[pool][strategy] != address(0)) revert VaultExists()` · `VaultFactory.sol:173` · One vault per (pool, strategy) pair — deployment de-duplication.

---

## 2. Inferred Invariants (Single-Contract)

Categories: `Conservation` · `Bound` · `Ratio` · `StateMachine` · `Temporal`.

---

#### I-1

`Bound` · On-chain: **Yes**

> `performanceFeeBps ∈ [0, 1000]` (≤ 10%) at all times.

**Derivation** — guard-lift G-12 (`bps > 1000` at propose:1038) + all write sites: `initialize:188` sets `1000`; `applyPerformanceFee:1050` sets `pendingFeeBps`, itself only writable by `proposePerformanceFee` behind the guard. No unguarded writer.

**If violated** — fees could exceed the advertised 10% cap on collected trading fees.

---

#### I-2

`Bound` · On-chain: **Yes**

> `slippageBps ∈ [0, 500]` (≤ 5%).

**Derivation** — guard-lift G-16 (`bps > 500` at setSlippageBps:1075) + write sites `initialize:191` (=50) and `setSlippageBps:1077`. Both bounded.

**If violated** — on-chain min-out floors would loosen, widening keeper swap/mint slippage tolerance.

---

#### I-3

`Bound` · On-chain: **Yes**

> `twapSeconds ≥ 60`.

**Derivation** — guard-lift G-14 (`seconds_ < 60` at setTwapSeconds:1065) + write sites `initialize:189` (=300) and `setTwapSeconds:1067`.

**If violated** — a short TWAP window approaches spot and weakens manipulation resistance.

---

#### I-4

`Bound` · On-chain: **Yes**

> `maxTwapDeviationTicks ∈ [1, 1000]`.

**Derivation** — guard-lift G-15 (`ticks <= 0 || ticks > 1000` at setMaxTwapDeviationTicks:1070) + write sites `initialize:190` (=200) and `setMaxTwapDeviationTicks:1072`.

**If violated** — deviation tolerance could be set to 0 (bricking deposits) or unbounded (defeating G-20).

---

#### I-5

`StateMachine` · On-chain: **Yes**

> `tokenId` is `0` until `initializePosition`, then always non-zero; thereafter it only cycles concrete→concrete via `rebalance`.

**Derivation** — edge: `tokenId == 0`@683 → `s.tokenId = newTokenId`@704 (guarded by G-9); reassigned at `_rebalanceMintNew:908`. No path resets it to 0.

**If violated** — a second `initializePosition` could orphan the live NFT and its liquidity.

---

#### I-6

`StateMachine` · On-chain: **Yes**

> Ownership transfers two-step: `pendingOwner` set by `transferOwnership`, consumed by `acceptOwnership` which sets `owner = pendingOwner` and clears `pendingOwner`.

**Derivation** — edge: `pendingOwner = newOwner_`@986 → `require(sender==pendingOwner)`@992 → `owner = pendingOwner; pendingOwner = 0`@994-995.

**If violated** — ownership could pass to an address that never accepted, risking a lost admin seat.

---

#### I-7

`Temporal` · On-chain: **Yes**

> A proposed fee change is only applyable at/after `feeChangeActiveAt = proposeTime + 2 days`.

**Derivation** — temporal: `s.feeChangeActiveAt = block.timestamp + 2 days`@1043 checked by `block.timestamp < s.feeChangeActiveAt`@1049 (G-13).

**If violated** — fee/recipient changes could take effect without the disclosed delay.

---

#### I-8

`Temporal` · On-chain: **No**

> A share holder cannot deposit and withdraw/redeem in the same block.

**Derivation** — temporal: `s.lastDepositBlock[receiver] = block.number` on deposit:390 / mint:427 / depositToken1:638; checked as `block.number <= s.lastDepositBlock[owner_]` at withdraw:452 / redeem:530. **Gap**: the stamp is keyed by `receiver` at deposit but the check reads `owner_` at exit; shares moved by ERC20 transfer to a fresh address carry no stamp, and a depositor funding a different receiver leaves their own address unstamped.

**If violated** — the same-block sandwich guard can be sidestepped by routing shares through an unstamped address.

---

#### I-9

`Conservation` · On-chain: **Yes**

> Exactly `DEAD_SHARES` (1000) are minted to `address(0xdead)` once, when `totalSupply == 0`.

**Derivation** — Δ-pair: `_mint(address(0xdead), DEAD_SHARES)` fires only inside the `supply == 0` branch at deposit:399, mint:438, depositToken1:657; no burn path removes them.

**If violated** — the first-depositor inflation offset would be absent.

---

#### I-10

`Ratio` · On-chain: **Yes**

> Deposit shares = `assets * totalSupply / totalValueBefore` (floor), snapshotting `totalValBefore` and `supply` *before* the incoming `safeTransferFrom`.

**Derivation** — `shares = Math.mulDiv(assets, supply, totalValBefore, Floor)`@403-408; `totalValBefore = _totalVaultValueInToken0()`@392 read before transfer@395.

**If violated** — mispricing on deposit would dilute or inflate existing holders.

---

#### I-11

`Ratio` · On-chain: **No**

> `totalAssets()` reflects only real vault-controlled value.

**Derivation** — `_totalVaultValueInToken0` sums `IERC20(token0/1).balanceOf(address(this))` + position value@1119-1144. **Gap**: idle legs read from `balanceOf`, so a direct token transfer (donation) to the vault raises `totalAssets` without minting shares.

**If violated** — donation-based share-price manipulation against the fixed 1000 dead-share offset.

---

#### I-12

`Conservation` · On-chain: **No** (negative observation)

> `totalFees0Earned` / `totalFees1Earned` are monotonic cumulative counters, not tied to any balance.

**Derivation** — every write is `+= fee` (withdraw:488, redeem:565, collectFees:761, rebalance:859); no decrement or reconciliation to real transfers.

**If violated** — display-only metrics; auditors should not treat them as an accounting invariant.

---

#### I-13

`Conservation` · On-chain: **No** (negative observation)

> `receive()` accepts ETH but no accounting tracks it.

**Derivation** — Δ-pair absent: `receive() external payable {}`@1082 has zero storage effect; only `sweepToken` (non-token0/1 ERC20) can move value out, and it cannot move native ETH.

**If violated** — native ETH sent to the vault is stranded (no withdrawal path); relevant only if the chain's gas token is ever routed here.

---

#### I-14

`Ratio` · On-chain: **Yes**

> Performance fee = `earned * performanceFeeBps / 10_000` rounded **up** (Ceil).

**Derivation** — `Math.mulDiv(earned0, s.performanceFeeBps, 10_000, Ceil)`@1257-1268; both legs use the same bounded rate (I-1).

**If violated** — rounding direction favors the protocol by ≤1 wei per leg (intentional).

---

#### I-15

`Temporal` · On-chain: **Yes**

> Every position-manager write carries `deadline = block.timestamp + 300`.

**Derivation** — temporal: mint/increase/decrease/collect all pass `deadline: block.timestamp + 300` (e.g. 699, 730, 827, 902, 972, 1211).

**If violated** — a pending keeper tx could execute at a stale price after long mempool delay; the 5-minute deadline bounds that window.

---

**Categories:** Conservation (equal-and-opposite Δ) · Bound (lifted guard across all writers) · Ratio (storage-formula) · StateMachine (guarded transition) · Temporal (block.timestamp/number).

---

## 3. Inferred Invariants (Cross-Contract)

---

#### X-1

On-chain: **Yes**

> The vault assumes `CLDexAdapter.positions()` returns `(tickLower, tickUpper, liquidity, tokensOwed0, tokensOwed1, token0, token1)` in exactly that order, re-projected from the position manager's 12-field struct.

**Caller side** — `RebalancerVaultUpgradeable.sol:1303-1319` (`_adapterPositions`) — destructures the tuple for valuation, slippage, and fee math.

**Callee side** — `CLDexAdapter.sol:33-63` — maps `INonfungiblePositionManager.positions` fields into the tuple; a wrong index silently corrupts every downstream calculation.

**If violated** — mis-indexed liquidity/owed values feed slippage floors, fee isolation, and TVL.

---

#### X-2

On-chain: **No**

> token1 value converts to token0 via the pool TWAP sqrt price with acceptable fidelity for share pricing and redeem payouts.

**Caller side** — `RebalancerVaultUpgradeable.sol:1151` (`_totalVaultValueInToken0`), `redeem:598-603`, `withdraw:498-501` — use `VaultMath.token1ToToken0(bal1, OracleLib.getTwapSqrtPrice(...))`.

**Callee side** — `OracleLib.sol:32-37` derives the sqrt price from `observe()`; `VaultMath.sol:21-33` squares `sqrtPrice` in Q96. **Gap**: no check the pool holds ≥ `twapSeconds` of observations (cardinality) — a low-cardinality pool reverts (`OLD`) or a manipulable/stale one skews the BTC↔MUSD magnitude conversion.

**If violated** — mispriced token1 leg distorts `totalAssets`, redeem `assets`, and withdraw swap sizing.

---

#### X-3

On-chain: **No**

> The delegatecalled adapter is stateless (declares no storage), so its writes touch only the position manager / router — never vault storage slots.

**Caller side** — `RebalancerVaultUpgradeable.sol:1322-1332` (`_delegateAdapter`) delegatecalls `s.dexAdapter` with mint/increase/decrease/collect/burn/swap calldata.

**Callee side** — `CLDexAdapter.sol:13` declares no state variables, satisfying the assumption for the shipped adapter. **Gap**: `setDexAdapter`@1028 lets the owner repoint `dexAdapter` to any contract, executed in vault context.

**If violated** — a malicious/incorrect adapter under delegatecall can overwrite any vault storage slot or move funds.

---

#### X-4

On-chain: **Yes**

> Strategy-provided ranges are re-validated by the vault, not trusted blindly.

**Caller side** — `RebalancerVaultUpgradeable.sol:1399-1409` (`_strategyRange`) checks `lo < hi` and `[MIN_TICK, MAX_TICK]`.

**Callee side** — `Strategy.sol:18-24` (`computeRange`) returns floor/ceil of `twapTick ± halfWidth`; an inverted or out-of-bounds range cannot pass the vault.

**If violated** — without re-validation a faulty strategy could mint a degenerate range; the check closes that.

---

## 4. Economic Invariants

---

#### E-1

On-chain: **No**

> Share price cannot be manipulated within a single block by moving the pool spot.

**Follows from** — I-11 + X-2 + G-20 (spot-near-TWAP). Valuation uses TWAP (not spot) and user actions require spot within `maxTwapDeviationTicks`, but I-11's `balanceOf`-based `totalAssets` (donation) and X-2's missing cardinality/observation guarantee leave residual manipulation surface.

**If violated** — a first/large depositor could tilt `sharePrice` via donation or TWAP staleness.

---

#### E-2

On-chain: **No**

> First-depositor inflation is fully neutralized.

**Follows from** — I-9 (fixed 1000 dead shares) + I-11 (donation-sensitive `totalAssets`). The dead-share offset is a fixed constant, not a virtual-asset offset, so a large donation before the second deposit can still round the second depositor's shares down.

**If violated** — the classic ERC-4626 inflation attack against early depositors.

---

#### E-3

On-chain: **Yes**

> Performance fee is charged only on the fee portion (swept − principal), never on depositor principal.

**Follows from** — I-1 (bounded rate) + I-14 + the `swept − p` / `tokensOwed − principal` separation at withdraw:484-487, redeem:561-568, rebalance:842-858, collectFees:754-759.

**If violated** — principal-eroding fees; the explicit principal subtraction prevents it.
