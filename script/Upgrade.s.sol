// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console2} from "forge-std/Script.sol";

import {
    RebalancerVaultUpgradeable
} from "../src/RebalancerVaultUpgradeable.sol";
import {VaultFactory} from "../src/factory/VaultFactory.sol";

contract Upgrade is Script {
    function run() external returns (address newImpl) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address factoryAddr = vm.envAddress("FACTORY_ADDRESS");

        VaultFactory factory = VaultFactory(factoryAddr);
        address oldImpl = factory.implementation();

        vm.startBroadcast(deployerKey);
        RebalancerVaultUpgradeable impl = new RebalancerVaultUpgradeable();
        factory.upgradeTo(address(impl));
        vm.stopBroadcast();

        newImpl = address(impl);

        console2.log("Factory (beacon):   ", factoryAddr);
        console2.log("Old implementation: ", oldImpl);
        console2.log("New implementation: ", newImpl);
    }
}
