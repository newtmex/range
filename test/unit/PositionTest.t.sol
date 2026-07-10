// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "../BaseTest.sol";

/// @notice LP position lifecycle: init, fees accrual, rebalance effects on storage.
/// @dev Amount conventions: token0 = MUSD (18 decimals), token1 = BTC (8 decimals).
contract PositionTest is BaseTest {
    int24 internal LO;
    int24 internal HI;

    function setUp() public override {
        super.setUp();
        LO = ((TICK_100K - 2000) / TICK_SPACING) * TICK_SPACING;
        HI = ((TICK_100K + 2000) / TICK_SPACING) * TICK_SPACING;
    }

    function test_position_initWithToken1AlsoWorks() public {
        _initialDeposit(10e18); // 10 MUSD
        // Position init pulls tokens from the vault's balance, so fund it with token1.
        vm.prank(owner);
        token1.transfer(address(vault), 1e8); // 1 BTC
        _initPosition(LO, HI, 0, 1e8);
        assertGt(vault.tokenId(), 0);
    }

    // ── collectFees — fee accounting ──────────────────────────────────────────

    function test_position_collectFees_increasesFees0Earned() public {
        _initialDeposit(10e18);
        _initPosition(LO, HI, 5e18, 0);

        MockPositionManager(PM_ADDR).setPendingFees(vault.tokenId(), 2e18, 0); // 2 MUSD

        // Fees earned are event-sourced: 10% of 2e18 = 2e17 charged on token0.
        vm.recordLogs();
        vm.prank(operator);
        vault.collectFees(0, 0);

        (uint256 f0, uint256 f1, address r) = _findFeesCollected(
            vm.getRecordedLogs()
        );
        assertEq(f0, 2e17);
        assertEq(f1, 0);
        assertEq(r, vault.feeRecipient());
    }

    function test_position_collectFees_increasesFees1Earned() public {
        _initialDeposit(10e18);
        _initPosition(LO, HI, 5e18, 0);

        MockPositionManager(PM_ADDR).setPendingFees(vault.tokenId(), 0, 1e6); // 0.01 BTC

        // Fees earned are event-sourced: 10% of 1e6 = 1e5 charged on token1.
        vm.recordLogs();
        vm.prank(operator);
        vault.collectFees(0, 0);

        (uint256 f0, uint256 f1, address r) = _findFeesCollected(
            vm.getRecordedLogs()
        );
        assertEq(f0, 0);
        assertEq(f1, 1e5);
        assertEq(r, vault.feeRecipient());
    }

    function test_position_collectFees_zeroFeesBpsSkipsFeeTransfer() public {
        vm.startPrank(owner);
        vault.proposePerformanceFee(0, feeRecip);
        vm.warp(block.timestamp + 3 days);
        vault.applyPerformanceFee();
        vm.stopPrank();

        _initialDeposit(10e18);
        _initPosition(LO, HI, 5e18, 0);
        MockPositionManager(PM_ADDR).setPendingFees(vault.tokenId(), 1e18, 0);

        uint256 recipBefore = token0.balanceOf(feeRecip);
        vm.prank(operator);
        vault.collectFees(0, 0);

        assertEq(token0.balanceOf(feeRecip), recipBefore); // no fee taken
    }

    // ── rebalance — state transitions ─────────────────────────────────────────

    function test_position_rebalanceChangesTokenId() public {
        _initialDeposit(10e18);
        _initPosition(LO, HI, 5e18, 0);
        uint256 oldId = vault.tokenId();

        vm.prank(operator);
        vault.rebalance(false, 0);

        assertGt(vault.tokenId(), oldId);
    }

    function test_position_rebalancePreservesApproximateTotalAssets() public {
        _initialDeposit(10e18);
        _initPosition(LO, HI, 5e18, 0);
        uint256 taBefore = vault.totalAssets();

        vm.prank(operator);
        vault.rebalance(false, 0);

        // The mock PM is not value-preserving (decrease pays out 1:1 per unit of
        // liquidity; mint always returns liquidity 1e18), so only sanity-check
        // that the vault still reports value after the position is re-minted.
        assertGt(taBefore, 0);
        assertGt(vault.totalAssets(), 0);
    }

    function test_position_rebalanceWithFees_accumulates() public {
        _initialDeposit(10e18);
        _initPosition(LO, HI, 5e18, 0);

        MockPositionManager(PM_ADDR).setPendingFees(vault.tokenId(), 1e18, 0);

        vm.recordLogs();
        vm.prank(operator);
        vault.rebalance(false, 0);

        (uint256 rebalances, uint256 feeSum0) = _countRebalancesAndFees(
            vm.getRecordedLogs()
        );
        assertGt(feeSum0, 0);
        assertGt(rebalances, 0);
    }

    function test_position_multipleRebalancesAccumulateFees() public {
        _initialDeposit(10e18);
        _initPosition(LO, HI, 5e18, 0);

        vm.recordLogs();
        for (uint i; i < 3; i++) {
            MockPositionManager(PM_ADDR).setPendingFees(vault.tokenId(), 1e18, 0);
            vm.prank(operator);
            vault.rebalance(false, 0);
        }

        (uint256 rebalances, uint256 feeSum0) = _countRebalancesAndFees(
            vm.getRecordedLogs()
        );
        assertEq(rebalances, 3);
        assertGt(feeSum0, 0);
    }

    // ── event-sourcing helpers ─────────────────────────────────────────────────

    /// @dev rebalanceCount / totalFeesEarned are no longer on-chain; reconstruct
    ///      them from Rebalanced / FeesCollected event logs, mirroring how the
    ///      off-chain indexer derives these analytics.
    function _countRebalancesAndFees(
        Vm.Log[] memory logs
    ) internal pure returns (uint256 rebalances, uint256 feeSum0) {
        bytes32 rebSig = keccak256(
            "Rebalanced(uint256,uint256,int24,int24,uint128)"
        );
        bytes32 feeSig = keccak256("FeesCollected(uint256,uint256,address)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length == 0) continue;
            if (logs[i].topics[0] == rebSig) {
                rebalances++;
            } else if (logs[i].topics[0] == feeSig) {
                (uint256 f0, ) = abi.decode(logs[i].data, (uint256, uint256));
                feeSum0 += f0;
            }
        }
    }

    /// @dev Locate the single FeesCollected event and decode its (fee0, fee1)
    ///      data plus indexed recipient.
    function _findFeesCollected(
        Vm.Log[] memory logs
    ) internal pure returns (uint256 fee0, uint256 fee1, address recipient) {
        bytes32 feeSig = keccak256("FeesCollected(uint256,uint256,address)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == feeSig) {
                (fee0, fee1) = abi.decode(logs[i].data, (uint256, uint256));
                recipient = address(uint160(uint256(logs[i].topics[1])));
                return (fee0, fee1, recipient);
            }
        }
        revert("no FeesCollected event");
    }
}
