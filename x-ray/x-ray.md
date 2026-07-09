# X-Ray Report

> Range (Rebalancer Vault) | 1954 nSLOC | 76c23242 (`main`) | Foundry | 09/07/26

Analyzed branch: `main` at `76c232420`.

---

## 1. Protocol Overview

**What it does:** An ERC-4626 vault that holds a single concentrated-liquidity NFT position on Mezo's Uniswap-V3-compatible DEX and has an off-chain keeper rebalance it back into range, compounding fees.

- **Users**: LPs deposit token0 (MUSD) or token1 (BTC), receive vault shares; a keeper rebalances.
- **Core flow**: `deposit` → shares; keeper `rebalance()` removes/re-mints the LP position around the current TWAP tick.
- **Key mechanism**: TWAP-anchored range selection + on-chain-derived slippage floors; one live position per vault.
- **Token model**: ERC-4626 shares (asset = token0); underlying = a CL pool pair (MUSD/BTC on mainnet).
- **Admin model**: per-vault `owner` (config, instant), `operator` (keeper), `guardian` (= factory, pause); `VaultFactory` is an `UpgradeableBeacon` whose owner can upgrade every vault.

For a visual overview of the protocol's architecture, see the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Vault core | RebalancerVaultUpgradeable | 1192 | ERC-4626 vault, deposit/withdraw/redeem, rebalance, admin, delegatecall plumbing |
| Factory / upgrade | VaultFactory | 174 | Beacon + deployer; guardian pause fan-out; per-(pool,strategy) registry |
| DEX seam | CLDexAdapter | 153 | Stateless staticcall/delegatecall adapter over pool + position manager + router |
| Pricing libs | OracleLib, VaultMath | 195 | TWAP read + spot-deviation check; token conversions, slippage, optimal-swap math |
| Storage / strategy | VaultStorageLib, Strategy | 73 | ERC-7201 namespaced storage; range picker (halfWidth) |
| View | VaultLens | 167 | Off-chain metrics + rebalance/deployIdle param computation |

*Vendored: `UniswapV3Math.sol` (415 nSLOC) — local 0.8 shim of Uniswap V3 FullMath/TickMath/LiquidityAmounts, excluded from authored scope (see §6 Forked Dependencies).*

### How It Fits Together

The core trick: user funds are held as **one** CL position plus idle balances, valued in token0 through a manipulation-resistant **TWAP** (never spot), and every value-moving action re-checks that spot sits within `maxTwapDeviationTicks` of that TWAP.

### Deposit

```
deposit(assets, receiver)
  ├─ OracleLib.requireSpotNearTwap()        // reverts if spot far from TWAP
  ├─ lastDepositBlock[receiver] = block.number
  ├─ totalValBefore = _totalVaultValueInToken0()   // TWAP-valued, snapshot BEFORE transfer
  ├─ token0.safeTransferFrom(sender → vault)
  └─ supply==0 ? mint 1000 dead shares + (assets-1000)
              : mint assets*supply/totalValBefore   // idle, deployed later by keeper
```
*First deposit burns 1000 dead shares to `0xdead`; shares mint on token0-denominated TWAP value, not `balanceOf`.*

### Rebalance (keeper)

```
rebalance(swapZeroForOne, swapAmount)
  ├─ requireSpotNearTwap()
  ├─ _rebalanceRemoveFeeCollectBurn(oldTokenId)
  │     ├─ decreaseLiquidity(all)  ── TWAP-derived amountMin (delegatecall adapter)
  │     ├─ feesOwed = tokensOwed - principal      // fee/principal isolation
  │     ├─ collect() → _deductPerformanceFee()    // fee → feeRecipient
  │     └─ burn(oldTokenId)
  ├─ _executeSwap(swapAmount, minOut=TWAP+slippage)   // keeper picks dir/amount; minOut on-chain
  └─ _rebalanceMintNew: Strategy.computeRange(twapTick) → vault re-validates → mint new position
```
*Keeper controls swap direction/amount but not the min-out floor — that is derived on-chain from TWAP + `slippageBps`.*

### Withdraw vs Redeem

```
withdraw(assets,…)  → remove pro-rata liquidity → collect ALL fees → fee on (swept-principal)
                    → burn shares → if idle token0 < assets: swap token1→token0 → transfer token0
redeem(shares,…)    → remove pro-rata liquidity → fee on (swept-principal)
                    → burn shares → pay user BOTH token0 and token1 (pro-rata idle + freed)
```
*`withdraw` guarantees exact token0 (may swap); `redeem` pays whatever mix the position yields — the two exit paths use different accounting.*

### Delegatecall adapter seam

```
vault._delegateAdapter(mint/increase/decrease/collect/burn/swap)
  └─ dexAdapter.delegatecall(...)   // runs in VAULT context: tokens, NFT, approvals stay in vault
     └─ CLDexAdapter (stateless) → PositionManager / SwapRouter
```
*The adapter must declare no storage; `setDexAdapter` (owner) can repoint this delegatecall target.*

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as: **Yield Aggregator / Vault (ERC-4626)** with **DEX/AMM (concentrated liquidity)** characteristics

ERC-4626 deposit/withdraw/convert wiring + single-position share accounting is the primary shape; the underlying value is a Uniswap-V3-style CL position (tick ranges, `sqrtPriceX96`, LP NFT), so AMM adversaries (spot manipulation, sandwich, empty-pool) apply to the pricing layer.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Owner (per vault) | Trusted | Instant: setOperator/Guardian/**Strategy**/**DexAdapter**, setPaused, sweepToken, twap/deviation/slippage params, initializePosition. Fee change only is 2-day timelocked. No delay on adapter/strategy repointing. |
| Operator (keeper) | Bounded (can only rebalance/deployIdle/collect with on-chain TWAP+slippage floors; cannot set min-out) | Chooses swap direction/amount each rebalance; subject to `whenNotPaused`. |
| Guardian | Bounded (can only pause) | `pauseByGuardian` / factory `pauseAll`. On mainnet guardian = factory. |
| Factory owner | Trusted | `deployVault`, `deploySeedAndInitialize`, `setGuardian`, and **`upgradeTo` — instant beacon upgrade of every vault** (no timelock). |
| feeRecipient | Untrusted sink | Receives performance-fee transfers; no callback path. |
| User / LP | Untrusted | deposit/mint/withdraw/redeem/depositToken1, permissionless within TWAP guard. |

**Adversary Ranking:**

1. **Donation / first-depositor inflation attacker** — `totalAssets` reads `balanceOf`, so a direct transfer inflates share price against a fixed (not virtual) 1000-dead-share offset.
2. **Oracle / TWAP manipulator** — the entire pricing and slippage-floor stack rests on the pool's `observe()` TWAP; low pool cardinality or a manipulable TWAP breaks valuation.
3. **Compromised owner / factory owner** — instant `setDexAdapter` (delegatecall target) and instant beacon `upgradeTo` are unbounded control paths over user funds.
4. **MEV / sandwich searcher** — keeper `rebalance`/`deployIdle` swap through the public pool; on-chain min-out is the only defense.
5. **Malicious keeper (bounded)** — picks swap size; bounded by TWAP min-out but can still churn positions / grief.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Owner → funds** — `setDexAdapter` repoints the delegatecall target (`RebalancerVaultUpgradeable.sol:1028`); a wrong/malicious adapter runs in vault context. No timelock, no multisig enforced in-code.
- **Factory owner → all vaults** — `UpgradeableBeacon.upgradeTo` (inherited, `VaultFactory.sol:18`) swaps the implementation for every deployed vault instantly; single highest-blast-radius key. *Git signal: 9 access_control + 12 fund_flows commits touch this surface.*
- **Fee timelock** — only `performanceFee` changes wait 2 days (`applyPerformanceFee:1049`); every other owner action is instant.
- **Guardian = factory** — pause is centralized in the factory; a lost factory-owner key still leaves guardian pause reachable only through the factory.

### Key Attack Surfaces

- **`totalAssets` donation sensitivity** &nbsp;&#91;[I-11](invariants.md#i-11), [E-2](invariants.md#e-2)&#93; — `_totalVaultValueInToken0:1119-1144` sums `balanceOf(this)` for both idle legs; worth confirming whether the fixed 1000 dead-share offset withstands a large direct transfer before the second deposit.

- **TWAP cardinality / staleness** &nbsp;&#91;[X-2](invariants.md#x-2)&#93; — `OracleLib._twapAndSpot:19` calls `observe([twapSeconds,0])` with no cardinality guarantee; worth tracing whether the mainnet pool holds ≥300s of observations (a known cardinality=1 gap) or reverts `OLD` / returns manipulable ticks.

- **`setDexAdapter` delegatecall target** &nbsp;&#91;[X-3](invariants.md#x-3)&#93; — `setDexAdapter:1028` + `_delegateAdapter:1322-1332`; worth confirming there is no on-chain constraint (statelessness, allowlist) on the repointed adapter that executes in vault context.

- **Beacon upgrade blast radius** — `VaultFactory` extends `UpgradeableBeacon`; worth confirming the intended owner is a timelock/multisig since `upgradeTo` re-implements every vault instantly.

- **Withdraw vs redeem accounting divergence** &nbsp;&#91;[E-3](invariants.md#e-3)&#93; — `withdraw:466-519` swaps the token1 shortfall and pays exact token0; `redeem:540-604` pays both tokens pro-rata with separate `freed`/`idleShare` math; worth tracing that the two paths credit the same value per share and that `swept0 - p0` / `tokensOwed0 - principal0` never underflow.

- **Same-block guard keying** &nbsp;&#91;[I-8](invariants.md#i-8)&#93; — `lastDepositBlock` is stamped on `receiver` at deposit but checked on `owner_` at exit (`452`/`530`); worth checking whether share transfers or third-party-receiver deposits bypass the same-block sandwich guard.

- **Rebalance fee-isolation underflow** &nbsp;&#91;[X-1](invariants.md#x-1)&#93; — `feesOwed0 = tokensOwed0 - uint128(principal0)` at `842-843`; worth confirming `tokensOwed` (read after `decreaseLiquidity`) always ≥ the principal returned, across rounding.

- **Keeper swap sizing** — `rebalance`/`deployIdle` accept keeper `swapAmount` and compute `minOut` from TWAP+slippage; worth tracing that an adversarial keeper cannot combine an in-range swap with slippage rounding to leak value within the min-out band.

### Upgrade Architecture Concerns

- **Instant beacon upgrade** — `VaultFactory : UpgradeableBeacon`; `upgradeTo` has no timelock; upgrading the shared implementation changes all vaults at once.
- **ERC-7201 storage layout** — `VaultStorageLib` fixes the namespaced slot; any upgrade must preserve the `VaultStorage` field order (the struct is not a gap-padded layout). Worth checking future implementations against it.
- **Implementation initializer** — constructor calls `_disableInitializers()` (`164`); `initialize` is `initializer`-gated and driven by the factory, closing the classic uninitialized-implementation window.

### Protocol-Type Concerns

**As a Yield Vault (ERC-4626):**
- Fixed dead-share offset (`DEAD_SHARES = 1000`) rather than OZ virtual-asset offset — `I-9`/`E-2`; verify sufficiency against token0 (MUSD) decimals.
- `previewMint`/`previewWithdraw` return `type(uint256).max` sentinels when `ta==0`/`supply==0` (`347`,`363-365`); confirm callers (factory seed path) never act on the sentinel.

**As a DEX/CL position manager:**
- token1↔token0 conversion squares `sqrtPrice` in Q96 (`VaultMath.token1ToToken0:27-32`) — for BTC (8 dec) vs MUSD (18 dec) magnitude gaps, confirm no precision truncation in `mulDiv` chains.
- `computeOptimalSwap` in-range branch (`VaultMath:55-98`) values both legs in token1 units; confirm the target-ratio math cannot return a swap that overshoots and re-crosses the range.

### Temporal Risk Profile

**Deployment & Initialization:**
- `deploySeedAndInitialize` seeds via `deposit` then `initializePosition` atomically (`VaultFactory:96-144`), avoiding an empty-vault front-run window; the standalone `deployVault` leaves a vault initialized-but-unseeded until the owner calls `initializePosition` — confirm the first external depositor cannot exploit the pre-position empty state.

**Market Stress:**
- Deposits/withdrawals hard-revert when spot deviates > `maxTwapDeviationTicks` from TWAP (`G-20`); during volatility this can *freeze* user exits (fail-closed), a liveness/stress trade-off worth noting.

### Composability & Dependency Risks

**Dependency Risk Map:**

> **CL Pool (Mezo DEX)** — via `OracleLib.observe` / `CLDexAdapter.slot0`
> - Assumes: `observe()` returns ≥`twapSeconds` of cumulative ticks; `slot0` spot near TWAP
> - Validates: spot-vs-TWAP deviation (G-20); zero sqrt price (G-21)
> - Mutability: external DEX; pool cardinality not controlled by protocol
> - On failure: reverts (`OLD` on insufficient observations) — fail-closed

> **NonfungiblePositionManager** — via `CLDexAdapter` (delegatecall)
> - Assumes: standard UniV3 12-field `positions` tuple; mint/decrease/collect semantics
> - Validates: `newLiquidity != 0` (G-11); TWAP-derived amountMin on decrease/mint
> - Mutability: external; adapter re-projects the tuple (X-1)
> - On failure: delegatecall bubbles revert

> **SwapRouter** — via `CLDexAdapter.exactInputSingle` (delegatecall)
> - Assumes: `exactInputSingle` honors `amountOutMinimum`
> - Validates: `amountOutMinimum` = TWAP+slippage floor, computed on-chain
> - Mutability: external
> - On failure: reverts if min-out unmet

**Token Assumptions** *(unvalidated only)*:
- Fee-on-transfer token0/token1: deposit credits `assets` (not measured delta) — impact: internal accounting > real balance if either asset takes a transfer fee.
- Rebasing token0/token1: `balanceOf`-based `totalAssets` would drift — impact: share-price accounting error.
- `_safeDecimals` falls back to 18 on a non-standard `decimals()` (`1275-1281`) — impact: mis-scaled `sharePrice` display if an asset returns non-standard data.

**Shared State Exposure:**
- The vault both reads (`observe`/`slot0`) and moves (swap, mint) the same public pool; large rebalance swaps and the vault's own liquidity affect that pool's spot/TWAP that this and any other integrator read.

---

## 3. Invariants

> ### 📋 Full invariant map: **[invariants.md](invariants.md)**
>
> A dedicated reference file contains the complete invariant analysis — do not look here for the catalog.
>
> - **22 Enforced Guards** (`G-1` … `G-22`) — per-call preconditions with `Check` / `Location` / `Purpose`
> - **15 Single-Contract Invariants** (`I-1` … `I-15`) — Conservation, Bound, Ratio, StateMachine, Temporal
> - **4 Cross-Contract Invariants** (`X-1` … `X-4`) — caller/callee pairs across scope boundaries
> - **3 Economic Invariants** (`E-1` … `E-3`) — higher-order properties deriving from `I-N` + `X-N`
>
> The **On-chain=No** blocks (`I-8`, `I-11`, `X-2`, `X-3`, `E-1`, `E-2`) are the high-signal ones — each is simultaneously an invariant and a potential bug. Attack-surface bullets above cross-link into the relevant blocks.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md` — thorough: deployed addresses, security table, rebalance steps, keeper bot |
| NatSpec | ~22 annotations | Good on public entry points and the delegatecall seam; sparse on private math helpers |
| Spec/Whitepaper | Present (partial) | `PROPERTIES.md` (28 KB) documents intended invariants/properties for the fuzz campaign |
| Inline Comments | Thorough | Fee-isolation and idle-vs-position rationale well commented in withdraw/redeem/rebalance |

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 40 | File scan (always reliable) |
| Test functions | 187 | File scan (always reliable) |
| Line coverage | Unavailable — 4 tests fail (fork init + zero-address reverts); `forge coverage` aborts | Coverage tool |
| Branch coverage | Unavailable — same reason | Coverage tool |

*183 of 187 tests pass; the 4 failures are 2 fork tests (`InitializePositionFork` — position already initialized on the live vault) and 2 `BeaconProxyTest` zero-address expectations. Test existence is confirmed by file scan regardless.*

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | ~180 | broad (vault, factory, math, oracle, adapter, view) |
| Fork | 2 files | Mezo testnet vaults (initialize, upgrade) |
| Stateless Fuzz | 0 | none |
| Stateful Fuzz (Foundry) | 0 | none (foundry.toml has an invariant profile but enumeration found 0 invariant test functions) |
| Stateful Fuzz (Echidna) | 0 functions : 1 config | `echidna.yaml` present, no harness functions detected |
| Stateful Fuzz (Medusa) | 0 functions : 1 config | `medusa.json` present, no harness functions detected |
| Formal Verification | 0 | none (Certora/Halmos/HEVM) |

### Gaps

- **No executable stateful fuzz/invariant tests** despite an invariant profile in `foundry.toml`, `echidna.yaml`, `medusa.json`, and a 28 KB `PROPERTIES.md` — the config scaffolding exists but enumeration found 0 invariant/fuzz functions. For a share-accounting + CL-math vault this is the highest-value gap (targets: `I-11`, `E-1`/`E-2`, `X-2`, fee-isolation `E-3`).
- **4 failing tests** should be triaged before audit — fork tests assume an uninitialized vault; the mismatch may hide a real setup drift.
- No formal verification of the token1↔token0 / liquidity math.

---

## 6. Developer & Git History

> Repo shape: normal_dev — 21 source-touching commits of 85 total over 65 days (2026-05-05 → 2026-07-09). Single-developer dominated.

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------|--------------------:|
| MananSinghal123 | 80 | +6586 / -3365 | 94.7% |
| newtmex | 2 | +366 / -12 | 5.3% |
| Manan Singhal | 3 | (same author, alt identity) | — |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 2–3 (mostly 1) | Single-dev |
| Merge commits | 3 of 85 (3.5%) | Minimal peer-review signal |
| Repo age | 2026-05-05 → 2026-07-09 | ~2 months |
| Recent source activity (30d) | 7 commits | Active, incl. a late security-fix commit |
| Test co-change rate | 76.2% | Most source commits also touch tests (co-modification, not coverage) |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| RebalancerVaultUpgradeable.sol | 9 | Central contract — highest churn, prioritize |
| VaultMath.sol | 6 | Math extracted/reworked repeatedly |
| OracleLib.sol | 5 | TWAP logic churned |
| CLDexAdapter.sol | 5 | Delegatecall seam |
| VaultLens.sol | 4 | View split-out |

### Security-Relevant Commits

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| f38c45374 | 2026-05-29 | fix: frontend build errors | 19 | adds guards + tightens access control (misleading subject) |
| b2ea0b25c | 2026-07-02 | fix: few smart contract vulnerability | 18 | +6 guards, +10 access control, spans 5 domains — **late, no test change** |
| c7b5afeb6 | 2026-06-03 | update: beacon proxy pattern | 14 | large; removes guards, changes accounting across 5 domains |
| 344f17548 | 2026-05-30 | fix: seperated view contract | 14 | removes guards; fund_flows + oracle |
| 4934a4445 | 2026-06-01 | fix: _s() routing, double-slot0, fee isolation | 13 | very large (>2000 lines); accounting + access control |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| oracle_price | 17 | RebalancerVaultUpgradeable, VaultMath, OracleLib, VaultLens |
| state_machines | 13 | RebalancerVaultUpgradeable, VaultStorageLib, OracleLib |
| fund_flows | 12 | RebalancerVaultUpgradeable, CLDexAdapter, VaultLens |
| access_control | 9 | RebalancerVaultUpgradeable, VaultFactory |
| signatures | 9 | RebalancerVaultUpgradeable |

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| UniswapV3Math shim | src/libraries/UniswapV3Math.sol | Uniswap V3 | Internalized | 0.8-port of FullMath/TickMath/LiquidityAmounts; upstream security fixes will NOT auto-propagate — verify against canonical source |
| v3-core, v3-periphery | lib/ | Uniswap V3 | Submodule | Standard submodules (0.7.6) |
| openzeppelin(-upgradeable) | lib/ | OpenZeppelin | Submodule | Standard |

### Security Observations

- **Single-developer concentration** — MananSinghal123 authored 94.7% of source; 3.5% merge-commit rate → little peer-review signal.
- **Late security fix without tests** — `b2ea0b25c` (2026-07-02) spans 5 security domains, `test_changed: false`; fix-without-test rate is 40%.
- **Highest churn = highest-value contract** — `RebalancerVaultUpgradeable.sol` (9 mods) concentrates deposit/withdraw/fee/rebalance logic.
- **Internalized Uniswap math** — the 0.8 shim is hand-ported; divergence from upstream is unmonitored attack surface.
- **Oracle code churned 17×** — the TWAP path (the whole price defense) is the most-modified area; correlates with the `X-2` cardinality gap.
- **Fuzz/invariant scaffolding without harnesses** — echidna/medusa configs + `PROPERTIES.md` exist but no runnable invariant functions.

### Cross-Reference Synthesis

- **Oracle churn (17 commits) ↔ X-2 / E-1** — the TWAP conversion + cardinality assumption is both the most-edited code and the top On-chain=No invariant → prioritize `OracleLib` + `VaultMath.token1ToToken0` review.
- **Beacon-proxy commit (`c7b5afeb6`, score 14, "removes guards") ↔ upgrade blast-radius surface** → diff this commit against the current beacon `upgradeTo` exposure.
- **`b2ea0b25c` late fix ↔ 4 failing tests** — a security-domain-spanning fix with no test change, plus unresolved failing fork/beacon tests → confirm the fix is actually covered before audit.

---

## X-Ray Verdict

**FRAGILE** — Roles and boundaries are clear and a README security table exists, but the codebase ships no runnable invariant/fuzz tests for share-accounting/CL math, has 4 failing tests, and concentrates unbounded control (instant `setDexAdapter` delegatecall repoint, instant beacon `upgradeTo`) with a fee-only timelock.

**Structural facts:**
1. ~1954 authored nSLOC across 8 in-scope contracts (+415 nSLOC vendored Uniswap math shim), single live CL position per vault.
2. Beacon-proxy upgradeable; `VaultFactory` (UpgradeableBeacon) owner can upgrade all vaults instantly.
3. 40 test files / 187 functions (183 pass, 4 fail); 0 stateful-fuzz/invariant/formal-verification functions despite config scaffolding.
4. Single developer wrote 94.7% of source; 3.5% merge-commit rate; oracle_price area changed in 17 commits.
5. 6 of 22 invariant/economic blocks are On-chain=No (I-8, I-11, X-2, X-3, E-1, E-2).
