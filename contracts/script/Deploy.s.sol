// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {TraderAgent} from "../src/TraderAgent.sol"; // Direction, Status, Round, Trade are at file level

contract DeployTraderAgent is Script {
    function run() external returns (TraderAgent traderAgent) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:       ", deployer);
        console.log("Balance (wei):  ", deployer.balance);
        console.log("Chain ID:       ", block.chainid);

        vm.startBroadcast(deployerPrivateKey);
        traderAgent = new TraderAgent();
        vm.stopBroadcast();

        console.log("\nTraderAgent deployed at:", address(traderAgent));
        console.log("\nAdd to .env:");
        console.log("  TRADERAGENT_CONTRACT_ADDRESS=", address(traderAgent));
        console.log("\nAdd to kwala/trader-execute-buy.yaml and trader-execute-sell.yaml:");
        console.log("  TriggerSourceContract:", address(traderAgent));
    }
}
