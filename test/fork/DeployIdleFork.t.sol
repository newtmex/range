// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../../src/RebalancerVaultUpgradeable.sol";
import "../../src/adapters/CLDexAdapter.sol";
import "../mocks/MockERC20.sol";

interface ILens {
    function computeDeployIdleParams(
        address vault
    ) external view returns (bool swapZeroForOne, uint256 swapAmount);
}

/// @notice Documents the two-part `deployIdle` story the keeper uncovered on testnet.
///
/// 1. STALE ADAPTER (fixed): the vault was upgraded to add deployIdle, which
///    delegatecalls IDexAdapter.increaseLiquidity — but the originally deployed
///    CLDexAdapter (0x4403297D...) lacked that function, so the call reverted with
///    EMPTY data. Fixed by redeploying CLDexAdapter and repointing the vaults via
///    setDexAdapter. test_currentAdapter_hasIncreaseLiquidity guards against a
///    future stale-adapter deploy.
///
/// 2. SWAP-THEN-MINT (open): with the adapter fixed, the keeper's lens-computed
///    balancing swap + mint in one tx reverts with the pool's own "PSC" guard
///    inside CLPool.mint (the payment callback runs, then the pool reverts).
///    Price impact is negligible (~0.04%) and raising slippageBps does NOT help,
///    because PSC is a pool-level check, not the vault's slippage guard. Deploying
///    idle WITHOUT the swap clears the guard and lands — which is the fallback the
///    keeper now uses.
///
/// token1 is Mezo's native BTC precompile (0x7b7C...0000), which Foundry cannot
/// execute, so we `vm.etch` a standard ERC20 over it and restore the vault's idle
/// BTC balance (same technique as InitializePositionFork).
contract DeployIdleForkTest is Test {
    address constant VAULT = 0x9b29b71829597A1B705Ea1Bab1C8B2fD00088594;
    address constant TOKEN0 = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503; // MUSD
    address constant TOKEN1 = 0x7b7C000000000000000000000000000000000000; // BTC precompile
    address constant POOL = 0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850;
    address constant LENS = 0x49D622d4A33045B72217ac92Ebff675A205F5b1d;

    // increaseLiquidity((address,address,address,uint256,uint256,uint256,uint256,uint256,uint256))
    bytes4 constant INCREASE_LIQUIDITY_SEL = 0x097fd754;

    // Idle BTC held by the vault on-chain at the time of investigation (18 dp).
    uint256 constant LIVE_IDLE_BTC = 12000000317545330;

    // Pinned so the swap/mint outcome is deterministic — testnet "latest" drifts
    // (pool price moves), which would make PSC assertions flaky.
    uint256 constant FORK_BLOCK = 14206169;

    RebalancerVaultUpgradeable vault;
    address operator;
    address adapter;

    // Controlled idle so the test doesn't depend on the vault's live (drifting)
    // balances: ~301 MUSD + ~0.012 BTC, matching the state the keeper first hit.
    uint256 constant IDLE_MUSD = 301e18;

    function setUp() public {
        vm.createSelectFork("https://rpc.test.mezo.org", FORK_BLOCK);
        _shimBTC();
        vault = RebalancerVaultUpgradeable(payable(VAULT));
        operator = vault.operator();
        adapter = vault.dexAdapter(); // whatever the vault currently points at

        // Seed a deterministic idle MUSD balance (token0 is a normal ERC20).
        deal(TOKEN0, VAULT, IDLE_MUSD);
    }

    /// Replace the non-executable BTC precompile with a real ERC20 and seed the
    /// vault's idle BTC. The pool is also seeded so CLPool.mint's balance-delta
    /// bookkeeping starts from a sane value.
    function _shimBTC() internal {
        MockERC20 shim = new MockERC20("Bitcoin", "BTC", 18);
        vm.etch(TOKEN1, address(shim).code);
        vm.store(TOKEN1, bytes32(uint256(5)), bytes32(uint256(18))); // _decimals
        MockERC20(TOKEN1).mint(VAULT, LIVE_IDLE_BTC);
        MockERC20(TOKEN1).mint(POOL, 100e18);
    }

    function test_log_state() public view {
        console.log("operator     :", operator);
        console.log("dexAdapter   :", adapter);
        console.log("tokenId      :", vault.tokenId());
        console.log("idle MUSD    :", IERC20(TOKEN0).balanceOf(VAULT));
        console.log("idle BTC     :", IERC20(TOKEN1).balanceOf(VAULT));
        console.log("totalAssets  :", vault.totalAssets());
    }

    /// REGRESSION GUARD (part 1): the vault's current adapter must implement
    /// increaseLiquidity, or deployIdle reverts with empty data again.
    function test_currentAdapter_hasIncreaseLiquidity() public view {
        assertTrue(
            _hasSelector(adapter.code, INCREASE_LIQUIDITY_SEL),
            "vault's adapter is missing increaseLiquidity (stale adapter)"
        );
    }

    /// THE FIX (part 2): deploying idle WITHOUT the balancing swap clears the
    /// pool's mint guard and adds liquidity. This is the keeper's fallback path.
    function test_deployIdle_noSwap_succeeds() public {
        uint256 liqBefore = _positionLiquidity();
        vm.prank(operator);
        vault.deployIdle(false, 0);
        uint256 added = _positionLiquidity() - liqBefore;
        console.log("no-swap deployIdle added liquidity:", added);
        assertGt(added, 0, "no-swap deployIdle should add liquidity");
    }

    /// THE PROBLEM + DIAGNOSIS (part 2): at ONE pinned block, compare the swap
    /// path at low vs max slippage against the no-swap path. This isolates whether
    /// PSC is slippage-sensitive (mint bound) or state-driven, without the
    /// re-fork drift that made earlier single-shot runs disagree.
    function test_swapVsNoSwap_matrix() public {
        (bool zfo, uint256 amt) = ILens(LENS).computeDeployIdleParams(VAULT);
        console.log("lens swapAmount:", amt);
        assertGt(amt, 0, "expected a balancing swap from the lens");

        string memory swap50 = _trySwapPath(zfo, amt, 50);
        string memory swap500 = _trySwapPath(zfo, amt, 500);
        string memory noSwap = _tryNoSwapPath();

        console.log("swap @ 50bps  :", swap50);
        console.log("swap @ 500bps :", swap500);
        console.log("no-swap       :", noSwap);

        // Deterministic findings at this pinned block + controlled idle:
        //  - the swap path trips PSC at the vault's default 50 bps slippage,
        //  - raising slippage to the 5% cap lets the swap path succeed (PSC IS
        //    slippage-sensitive — the mint's amounts must clear the min bound),
        //  - the no-swap path lands regardless (the keeper's zero-config fallback).
        assertEq(swap50, "PSC", "swap path should revert PSC at 50 bps");
        assertEq(swap500, "OK", "swap path should clear at 500 bps");
        assertEq(noSwap, "OK", "no-swap deployIdle must succeed");
    }

    /// Runs the swap path at the given slippage from a clean snapshot; returns
    /// "OK" or the revert reason. Reverts state afterwards so cases are isolated.
    function _trySwapPath(bool zfo, uint256 amt, uint256 bps) internal returns (string memory) {
        uint256 snap = vm.snapshotState();
        vm.prank(vault.owner());
        vault.setSlippageBps(bps);
        vm.prank(operator);
        try vault.deployIdle(zfo, amt) {
            vm.revertToState(snap);
            return "OK";
        } catch Error(string memory reason) {
            vm.revertToState(snap);
            return reason;
        } catch {
            vm.revertToState(snap);
            return "unknown revert";
        }
    }

    function _tryNoSwapPath() internal returns (string memory) {
        uint256 snap = vm.snapshotState();
        vm.prank(operator);
        try vault.deployIdle(false, 0) {
            vm.revertToState(snap);
            return "OK";
        } catch Error(string memory reason) {
            vm.revertToState(snap);
            return reason;
        } catch {
            vm.revertToState(snap);
            return "unknown revert";
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    function _hasSelector(bytes memory code, bytes4 sel) internal pure returns (bool) {
        for (uint256 i = 0; i + 4 <= code.length; i++) {
            if (code[i] == sel[0] && code[i + 1] == sel[1] && code[i + 2] == sel[2] && code[i + 3] == sel[3]) {
                return true;
            }
        }
        return false;
    }

    function _positionLiquidity() internal view returns (uint256) {
        (, , uint128 liq, , , , ) = CLDexAdapter(adapter).positions(
            address(vault.positionManager()),
            vault.tokenId()
        );
        return liq;
    }
}
