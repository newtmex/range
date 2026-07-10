// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console2} from "forge-std/Script.sol";

import {
    RebalancerVaultUpgradeable
} from "../src/RebalancerVaultUpgradeable.sol";
import {VaultFactory} from "../src/factory/VaultFactory.sol";
import {CLDexAdapter} from "../src/adapters/CLDexAdapter.sol";
import {Strategy} from "../src/strategies/Strategy.sol";
import {VaultLens} from "../src/VaultLens.sol";

contract Deploy is Script {
    address constant MEZO_POOL = 0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850;
    address constant MEZO_POS_MGR = 0x9B753e11bFEd0D88F6e1D2777E3c7dac42F96062;

    int24 constant HALF_WIDTH_TIGHT = 600; //  ±600  ticks  (~±6%)
    int24 constant HALF_WIDTH_MEDIUM = 1_000; //  ±2000 ticks  (~±10%)
    int24 constant HALF_WIDTH_WIDE = 2_000; //  ±6000 ticks  (~±20%)

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("OWNER_ADDRESS");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address pool = vm.envAddress("POOL_ADDRESS");
        address positionManager = vm.envAddress("POSITION_MANAGER");
        address swapRouter = vm.envAddress("SWAP_ROUTER");

        vm.startBroadcast(deployerKey);

        RebalancerVaultUpgradeable impl = new RebalancerVaultUpgradeable();
        console2.log("Implementation:", address(impl));

        CLDexAdapter dexAdapter = new CLDexAdapter();
        console2.log("CLDexAdapter:  ", address(dexAdapter));

        VaultLens lens = new VaultLens();
        console2.log("VaultLens:     ", address(lens));

        VaultFactory factory = new VaultFactory(
            address(impl),
            positionManager,
            swapRouter,
            address(dexAdapter),
            guardian,
            owner
        );
        console2.log("VaultFactory:  ", address(factory));

        Strategy stratTight = new Strategy(HALF_WIDTH_TIGHT);
        Strategy stratMedium = new Strategy(HALF_WIDTH_MEDIUM);
        Strategy stratWide = new Strategy(HALF_WIDTH_WIDE);
        console2.log("Strategy tight: ", address(stratTight));
        console2.log("Strategy medium:", address(stratMedium));
        console2.log("Strategy wide:  ", address(stratWide));

        address vaultTight = factory.deployVault(
            pool,
            address(stratTight),
            owner,
            operator,
            feeRecipient,
            "Mezo MUSD/BTC Tight",
            "mMUSD-BTC-T"
        );
        console2.log("Vault tight:   ", vaultTight);

        address vaultMedium = factory.deployVault(
            pool,
            address(stratMedium),
            owner,
            operator,
            feeRecipient,
            "Mezo MUSD/BTC Medium",
            "mMUSD-BTC-M"
        );
        console2.log("Vault medium:  ", vaultMedium);

        address vaultWide = factory.deployVault(
            pool,
            address(stratWide),
            owner,
            operator,
            feeRecipient,
            "Mezo MUSD/BTC Wide",
            "mMUSD-BTC-W"
        );
        console2.log("Vault wide:    ", vaultWide);

        vm.stopBroadcast();

        // ── Summary ──────────────────────────────────────────────────────────
        console2.log("\n=== Deployment Summary ===");
        console2.log("Implementation:  ", address(impl));
        console2.log("CLDexAdapter:    ", address(dexAdapter));
        console2.log("VaultLens:       ", address(lens));
        console2.log("VaultFactory:    ", address(factory));
        console2.log("Strategy tight:  ", address(stratTight));
        console2.log("Strategy medium: ", address(stratMedium));
        console2.log("Strategy wide:   ", address(stratWide));
        console2.log("Vault tight:     ", vaultTight);
        console2.log("Vault medium:    ", vaultMedium);
        console2.log("Vault wide:      ", vaultWide);

        console2.log("\nVaults deployed uninitialized.");
        console2.log("Initialize each position manually via cast (see README).");
    }
}
