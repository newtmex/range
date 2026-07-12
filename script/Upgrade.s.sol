// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console2} from "forge-std/Script.sol";

import {
    RebalancerVaultUpgradeable
} from "../src/RebalancerVaultUpgradeable.sol";
import {VaultFactory} from "../src/factory/VaultFactory.sol";

contract Upgrade is Script {
    function run() external returns (address newImpl) {
        address factoryAddr = vm.envAddress("FACTORY_ADDRESS");

        VaultFactory factory = VaultFactory(factoryAddr);
        address oldImpl = factory.implementation();

        // Signer selection:
        //   - Hardware wallet (mainnet owner): set USE_HW_WALLET=true and pass the wallet
        //     flag + sender on the CLI, e.g. `--trezor --sender <OWNER_ADDRESS>`
        //     (or `--ledger --sender <OWNER_ADDRESS>`). No PRIVATE_KEY needed.
        //   - Hot key (testnet): leave USE_HW_WALLET unset; PRIVATE_KEY (0x-prefixed) is used.
        // `upgradeTo` is onlyOwner on the beacon, so the broadcasting signer MUST be the
        // factory owner.
        if (vm.envOr("USE_HW_WALLET", false)) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        }
        RebalancerVaultUpgradeable impl = new RebalancerVaultUpgradeable();
        factory.upgradeTo(address(impl));
        vm.stopBroadcast();

        newImpl = address(impl);

        console2.log("Factory (beacon):   ", factoryAddr);
        console2.log("Old implementation: ", oldImpl);
        console2.log("New implementation: ", newImpl);
    }
}
