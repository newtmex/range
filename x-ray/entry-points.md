# Entry Point Map

> Range (Rebalancer Vault) | 22 entry points | 6 permissionless | 6 role-gated | 10 admin-only

---

## Protocol Flow Paths

### Setup (Factory Owner)

`VaultFactory.deployVault()` → `RebalancerVault.initialize()` (via BeaconProxy) → `initializePosition()`  ◄── owner-only, once

`VaultFactory.deploySeedAndInitialize()` → deploy + `deposit(seed)` + `initializePosition()` + `transferOwnership()`  ◄── atomic bootstrap

### User Flow

`[position initialized above]` → `deposit()` / `depositToken1()` / `mint()`  ◄── requires spot within `maxTwapDeviationTicks` of TWAP
                                        ├─→ `withdraw()`  ◄── block.number > lastDepositBlock[owner]
                                        └─→ `redeem()`    ◄── same-block guard; pays both tokens

### Maintenance (Operator / Keeper)

`[position initialized]` → [price drifts out of range] → `VaultLens.computeRebalanceParams()` (off-chain) → `rebalance(swapZeroForOne, swapAmount)`

`[idle tokens accrue]` → `VaultLens.computeDeployIdleParams()` (off-chain) → `deployIdle(swapZeroForOne, swapAmount)`

`[fees accrue]` → `collectFees(amount0Min, amount1Min)`

### Emergency (Guardian)

`VaultFactory.pauseAll()` → for each vault `RebalancerVault.pauseByGuardian()`  ◄── guardian == factory

### Fee Change (Owner)

`proposePerformanceFee()` → [2 days pass] → `applyPerformanceFee()`

---

## Permissionless

Callable by any address (subject to `whenNotPaused` + TWAP-proximity checks). Sorted tokens-in first.

### `RebalancerVault.deposit(assets, receiver)`

| Aspect | Detail |
|--------|--------|
| Visibility | public, nonReentrant, whenNotPaused |
| Caller | User |
| Parameters | assets (user-controlled), receiver (user-controlled) |
| Call chain | `→ OracleLib.requireSpotNearTwap() → IERC20.safeTransferFrom() → _mint()` |
| State modified | `lastDepositBlock[receiver]`, `_balances`, `_totalSupply` |
| Value flow | token0: sender → Vault |
| Reentrancy guard | yes |

### `RebalancerVault.mint(shares, receiver)`

| Aspect | Detail |
|--------|--------|
| Visibility | public, nonReentrant, whenNotPaused |
| Caller | User |
| Parameters | shares (user-controlled), receiver (user-controlled) |
| Call chain | `→ requireSpotNearTwap() → previewMint() → safeTransferFrom() → _mint()` |
| State modified | `lastDepositBlock[receiver]`, `_balances`, `_totalSupply` |
| Value flow | token0: sender → Vault |
| Reentrancy guard | yes |

### `RebalancerVault.depositToken1(token1Amount, receiver)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant, whenNotPaused |
| Caller | User |
| Parameters | token1Amount (user-controlled), receiver (user-controlled) |
| Call chain | `→ requireSpotNearTwap() → safeTransferFrom(token1) → VaultMath.token1ToToken0(TWAP) → _mint()` |
| State modified | `lastDepositBlock[receiver]`, `_balances`, `_totalSupply` |
| Value flow | token1: sender → Vault |
| Reentrancy guard | yes |

### `RebalancerVault.withdraw(assets, receiver, owner_)`

| Aspect | Detail |
|--------|--------|
| Visibility | public, nonReentrant, whenNotPaused |
| Caller | User (share owner or approved spender) |
| Parameters | assets (user-controlled), receiver (user-controlled), owner_ (user-controlled) |
| Call chain | `→ requireSpotNearTwap() → _removeProportionalLiquidity() → _decreaseLiquidity()/_collect() (delegatecall adapter) → _deductPerformanceFee() → _burn() → _executeSwap() (if shortfall) → safeTransfer(token0)` |
| State modified | position liquidity, `totalFees0/1Earned`, `_balances`, `_totalSupply` |
| Value flow | token0: Vault → receiver |
| Reentrancy guard | yes |

### `RebalancerVault.redeem(shares, receiver, owner_)`

| Aspect | Detail |
|--------|--------|
| Visibility | public, nonReentrant, whenNotPaused |
| Caller | User (share owner or approved spender) |
| Parameters | shares (user-controlled), receiver (user-controlled), owner_ (user-controlled) |
| Call chain | `→ requireSpotNearTwap() → _removeProportionalLiquidity() → _deductPerformanceFee() → _burn() → safeTransfer(token0) + safeTransfer(token1)` |
| State modified | position liquidity, `totalFees0/1Earned`, `_balances`, `_totalSupply` |
| Value flow | token0 + token1: Vault → receiver |
| Reentrancy guard | yes |

### `RebalancerVault.receive()`

| Aspect | Detail |
|--------|--------|
| Visibility | external payable |
| Caller | Anyone |
| Parameters | none |
| Call chain | (empty body) |
| State modified | native balance only (no accounting) |
| Value flow | ETH: sender → Vault (no withdrawal path) |
| Reentrancy guard | no |

---

## Role-Gated

### `Operator` (keeper)

#### `RebalancerVault.rebalance(swapZeroForOne, swapAmount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant, whenNotPaused, positionExists |
| Caller | Keeper bot |
| Parameters | swapZeroForOne (keeper-provided), swapAmount (keeper-provided) |
| Call chain | `→ requireSpotNearTwap() → _rebalanceRemoveFeeCollectBurn() → _executeSwap() → _rebalanceMintNew() → Strategy.computeRange() → _mintPosition() (delegatecall)` |
| State modified | `tokenId`, `rebalanceCount`, `totalFees0/1Earned`, position |
| Value flow | internal (removes + re-mints position; fee → feeRecipient) |
| Reentrancy guard | yes |

#### `RebalancerVault.deployIdle(swapZeroForOne, swapAmount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant, whenNotPaused, positionExists |
| Caller | Keeper bot |
| Parameters | swapZeroForOne (keeper-provided), swapAmount (keeper-provided) |
| Call chain | `→ requireSpotNearTwap() → _executeSwap() → _increaseLiquidity() (delegatecall)` |
| State modified | position liquidity |
| Value flow | internal (idle tokens → existing position) |
| Reentrancy guard | yes |

#### `RebalancerVault.collectFees(amount0Min, amount1Min)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant, whenNotPaused, positionExists |
| Caller | Keeper bot |
| Parameters | amount0Min (keeper-provided), amount1Min (keeper-provided) |
| Call chain | `→ _decreaseLiquidity(0) → _collect() (delegatecall) → _deductPerformanceFee()` |
| State modified | `totalFees0/1Earned` |
| Value flow | fee → feeRecipient; net stays idle in Vault |
| Reentrancy guard | yes |

### `pendingOwner`

#### `RebalancerVault.acceptOwnership()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | pendingOwner |
| Parameters | none |
| Call chain | `→ owner = pendingOwner; pendingOwner = 0` |
| State modified | `owner`, `pendingOwner` |
| Value flow | none |
| Reentrancy guard | no |

### `guardian`

#### `RebalancerVault.pauseByGuardian()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | guardian (the VaultFactory) |
| Parameters | none |
| Call chain | `→ paused = true` |
| State modified | `paused` |
| Value flow | none |
| Reentrancy guard | no |

### `VaultFactory` guardian

#### `VaultFactory.pauseAll()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, onlyGuardian |
| Caller | Guardian |
| Parameters | none |
| Call chain | `→ loop allVaults → RebalancerVault.pauseByGuardian()` |
| State modified | `paused` on every deployed vault |
| Value flow | none |
| Reentrancy guard | no |

---

## Admin-Only

`RebalancerVault` owner and `VaultFactory` owner (beacon owner). All operational actions are instant (no timelock except the fee change).

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| RebalancerVault | `initializePosition(tickLower, tickUpper, amount0/1Desired, amount0/1Min)` | ticks + amounts (owner) | `tokenId` (one-shot) |
| RebalancerVault | `transferOwnership(newOwner_)` | newOwner_ (owner) | `pendingOwner` |
| RebalancerVault | `setOperator(newOperator)` | newOperator (owner) | `operator` |
| RebalancerVault | `setPaused(bool)` | _paused (owner) | `paused` |
| RebalancerVault | `setGuardian(newGuardian)` | newGuardian (owner) | `guardian` |
| RebalancerVault | `setStrategy(newStrategy)` | newStrategy (owner) | `strategy` |
| RebalancerVault | `setDexAdapter(newAdapter)` | newAdapter (owner) | `dexAdapter` (delegatecall target) |
| RebalancerVault | `proposePerformanceFee(bps, recipient)` | bps ≤ 1000, recipient (owner) | `pendingFeeBps`, `pendingFeeRecipient`, `feeChangeActiveAt` |
| RebalancerVault | `applyPerformanceFee()` | none (owner) | `performanceFeeBps`, `feeRecipient` (after 2-day lock) |
| RebalancerVault | `sweepToken(token, to)` | token≠token0/1, to (owner) | transfers stray ERC20 out |
| RebalancerVault | `setTwapSeconds(seconds_)` | ≥60 (owner) | `twapSeconds` |
| RebalancerVault | `setMaxTwapDeviationTicks(ticks)` | (0,1000] (owner) | `maxTwapDeviationTicks` |
| RebalancerVault | `setSlippageBps(bps)` | ≤500 (owner) | `slippageBps` |
| VaultFactory | `deployVault(pool, strategy, owner, operator, feeRecipient, name, symbol)` | (factory owner) | `vaultFor`, `allVaults` |
| VaultFactory | `deploySeedAndInitialize(...)` | + seedAssets, ticks, mins (factory owner) | deploys, seeds, initializes, transfers |
| VaultFactory | `setGuardian(newGuardian)` | newGuardian (factory owner) | `guardian` |
| VaultFactory | `upgradeTo(newImpl)` *(UpgradeableBeacon)* | newImpl (factory owner) | beacon implementation for ALL vaults |

---

## Initialization

- `RebalancerVault.initialize(InitParams)` — `initializer`-gated, called once by the BeaconProxy constructor with factory-encoded params. Sets owner/operator/guardian/pool/tokens/adapters and default params (fee 1000 bps, twap 300s, deviation 200 ticks, slippage 50 bps). The implementation constructor calls `_disableInitializers()`.
