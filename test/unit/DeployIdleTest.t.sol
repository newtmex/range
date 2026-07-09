// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "../BaseTest.sol";
import {VaultMath} from "../../src/libraries/VaultMath.sol";
import {TickMath} from "../../src/libraries/UniswapV3Math.sol";

contract DeployIdleTest is BaseTest {
    int24 internal LO;
    int24 internal HI;

    function setUp() public override {
        super.setUp();
        LO = ((TICK_100K - 2000) / TICK_SPACING) * TICK_SPACING;
        HI = ((TICK_100K + 2000) / TICK_SPACING) * TICK_SPACING;
    }

    function _posLiquidity() internal view returns (uint128 liq) {
        (, , , , , , , liq, , , , ) = MockPositionManager(PM_ADDR).positions(
            vault.tokenId()
        );
    }

    /// @dev Mirrors VaultLens.computeDeployIdleParams: optimal swap over the existing
    ///      range using the vault's idle balances.
    function _idleSwapParams() internal view returns (bool z, uint256 amt) {
        (uint160 sqrtP, , , , , ) = pool.slot0();
        return
            VaultMath.computeOptimalSwap(
                sqrtP,
                TickMath.getSqrtRatioAtTick(LO),
                TickMath.getSqrtRatioAtTick(HI),
                token0.balanceOf(address(vault)),
                token1.balanceOf(address(vault))
            );
    }

    /// @dev Fresh idle token0 sitting on top of an existing position gets swapped to
    ///      the range ratio and added to the SAME tokenId — no re-range, no new NFT.
    function test_deployIdle_addsToExistingPosition() public {
        _initialDeposit(100e18); // vault holds 100e18 idle token0
        _initPosition(LO, HI, 40e18, 0); // pulls 40e18 into the position
        vm.roll(block.number + 1);

        uint256 tid = vault.tokenId();
        uint128 liqBefore = _posLiquidity();
        // The vault calls the router etched at ROUTER_ADDR, not the template instance.
        uint256 swapsBefore = MockCLSwapRouter(ROUTER_ADDR).swapCallCount();

        (bool z, uint256 amt) = _idleSwapParams();
        vm.prank(operator);
        vault.deployIdle(z, amt);

        // Same position, more liquidity, exactly one ratio swap.
        assertEq(vault.tokenId(), tid, "tokenId must not change");
        assertGt(_posLiquidity(), liqBefore, "liquidity must increase");
        assertEq(
            MockCLSwapRouter(ROUTER_ADDR).swapCallCount(),
            swapsBefore + 1,
            "one swap expected"
        );
    }

    function test_deployIdle_onlyOperator() public {
        _initialDeposit(100e18);
        _initPosition(LO, HI, 40e18, 0);
        vm.roll(block.number + 1);

        vm.prank(alice);
        vm.expectRevert(RebalancerVaultUpgradeable.NotOperator.selector);
        vault.deployIdle(false, 0);
    }

    function test_deployIdle_revertsWhenNoPosition() public {
        _initialDeposit(100e18);
        vm.roll(block.number + 1);

        vm.prank(operator);
        vm.expectRevert(RebalancerVaultUpgradeable.NotInitialized.selector);
        vault.deployIdle(false, 0);
    }

    function test_deployIdle_revertsWhenPaused() public {
        _initialDeposit(100e18);
        _initPosition(LO, HI, 40e18, 0);
        vm.roll(block.number + 1);

        vm.prank(owner);
        vault.setPaused(true);

        vm.prank(operator);
        vm.expectRevert(RebalancerVaultUpgradeable.Paused.selector);
        vault.deployIdle(false, 0);
    }
}
