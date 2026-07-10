// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../../src/RebalancerVaultUpgradeable.sol";
import {VaultFactory} from "../../src/factory/VaultFactory.sol";
import "../mocks/MockERC20.sol";

contract UpgradeForkTest is Test {
    // ERC-1967 beacon slot: bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1)
    bytes32 constant BEACON_SLOT =
        0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;

    address constant VAULT = 0x9b29b71829597A1B705Ea1Bab1C8B2fD00088594;
    address constant TOKEN1 = 0x7b7C000000000000000000000000000000000000; // BTC

    RebalancerVaultUpgradeable vault;
    VaultFactory factory;

    address ownerBefore;
    address operatorBefore;
    address guardianBefore;
    bool pausedBefore;
    address strategyBefore;
    address dexAdapterBefore;
    address poolBefore;
    address token0Before;
    address token1Before;
    uint8 decimals0Before;
    uint8 decimals1Before;
    address positionManagerBefore;
    address swapRouterBefore;
    uint256 tokenIdBefore;
    uint256 performanceFeeBpsBefore;
    address feeRecipientBefore;
    uint32 twapSecondsBefore;
    uint256 totalSupplyBefore;
    uint256 totalAssetsBefore;
    string nameBefore;
    string symbolBefore;

    function setUp() public {
        vm.createSelectFork("https://rpc.test.mezo.org");
        _shimToken1AsERC20();
        vault = RebalancerVaultUpgradeable(payable(VAULT));

        address beacon = address(uint160(uint256(vm.load(VAULT, BEACON_SLOT))));
        factory = VaultFactory(beacon);

        ownerBefore = vault.owner();
        operatorBefore = vault.operator();
        guardianBefore = vault.guardian();
        pausedBefore = vault.paused();
        strategyBefore = vault.strategy();
        dexAdapterBefore = vault.dexAdapter();
        poolBefore = address(vault.pool());
        token0Before = address(vault.token0());
        token1Before = address(vault.token1());
        decimals0Before = vault.decimals0();
        decimals1Before = vault.decimals1();
        positionManagerBefore = address(vault.positionManager());
        swapRouterBefore = address(vault.swapRouter());
        tokenIdBefore = vault.tokenId();
        performanceFeeBpsBefore = vault.performanceFeeBps();
        feeRecipientBefore = vault.feeRecipient();
        twapSecondsBefore = vault.twapSeconds();
        totalSupplyBefore = vault.totalSupply();
        totalAssetsBefore = vault.totalAssets();
        nameBefore = vault.name();
        symbolBefore = vault.symbol();
    }

    function _shimToken1AsERC20() internal {
        MockERC20 shim = new MockERC20("Bitcoin", "BTC", 8);
        vm.etch(TOKEN1, address(shim).code);

        // OpenZeppelin ERC20 stores `_decimals` after balances, allowances,
        // totalSupply, name, and symbol.
        vm.store(TOKEN1, bytes32(uint256(5)), bytes32(uint256(8)));
    }

    function test_upgrade_preservesVaultState() public {
        RebalancerVaultUpgradeable newImpl = new RebalancerVaultUpgradeable();

        vm.prank(factory.owner());
        factory.upgradeTo(address(newImpl));

        assertEq(factory.implementation(), address(newImpl), "beacon not upgraded");

        assertEq(vault.owner(), ownerBefore, "owner changed");
        assertEq(vault.operator(), operatorBefore, "operator changed");
        assertEq(vault.guardian(), guardianBefore, "guardian changed");
        assertEq(vault.paused(), pausedBefore, "paused changed");
        assertEq(vault.strategy(), strategyBefore, "strategy changed");
        assertEq(vault.dexAdapter(), dexAdapterBefore, "dexAdapter changed");
        assertEq(address(vault.pool()), poolBefore, "pool changed");
        assertEq(address(vault.token0()), token0Before, "token0 changed");
        assertEq(address(vault.token1()), token1Before, "token1 changed");
        assertEq(vault.decimals0(), decimals0Before, "decimals0 changed");
        assertEq(vault.decimals1(), decimals1Before, "decimals1 changed");
        assertEq(address(vault.positionManager()), positionManagerBefore, "positionManager changed");
        assertEq(address(vault.swapRouter()), swapRouterBefore, "swapRouter changed");
        assertEq(vault.tokenId(), tokenIdBefore, "tokenId changed");
        assertEq(vault.performanceFeeBps(), performanceFeeBpsBefore, "performanceFeeBps changed");
        assertEq(vault.feeRecipient(), feeRecipientBefore, "feeRecipient changed");
        assertEq(vault.twapSeconds(), twapSecondsBefore, "twapSeconds changed");
        assertEq(vault.totalSupply(), totalSupplyBefore, "totalSupply changed");
        // token0 (live MUSD) accrues yield continuously against block.timestamp,
        // so totalAssets legitimately drifts by dust between two view calls
        // regardless of the upgrade; assert it stays within that noise floor.
        assertApproxEqAbs(vault.totalAssets(), totalAssetsBefore, 1e6, "totalAssets drifted more than yield-accrual noise");
        assertEq(vault.name(), nameBefore, "name changed");
        assertEq(vault.symbol(), symbolBefore, "symbol changed");
    }

    function test_upgrade_onlyFactoryOwnerCanUpgrade() public {
        RebalancerVaultUpgradeable newImpl = new RebalancerVaultUpgradeable();

        address notOwner = makeAddr("notOwner");
        vm.prank(notOwner);
        vm.expectRevert();
        factory.upgradeTo(address(newImpl));
    }

    function test_upgrade_vaultRemainsFunctionalAfterUpgrade() public {
        RebalancerVaultUpgradeable newImpl = new RebalancerVaultUpgradeable();

        vm.prank(factory.owner());
        factory.upgradeTo(address(newImpl));

        assertEq(factory.implementation(), address(newImpl));
        assertEq(vault.asset(), token0Before, "vault broken post-upgrade");
    }
}
