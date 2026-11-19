// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IMorpho} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {Lens} from "../src/Lens.sol";
import {MarginRouter} from "../src/MarginRouter.sol";

/// Replaces the router of an existing deployment (SC-87): a new MarginRouter with the code in `main`
/// (SC-86, D-79) over the same RiskManager and markets, and a new Lens, since Lens is bound to its
/// router. The old router keeps working; positions live in the users' own Morpho accounts, so the new
/// router can close them once the user authorizes it. Opt-in protection does not move: each user opts
/// in again. The deployment file keeps the old address under `previousRouters` for the indexer.
contract RedeployRouter is Script {
    struct Redeployed {
        MarginRouter router;
        Lens lens;
    }

    function run() external {
        string memory config = vm.readFile(vm.envOr("DEPLOY_CONFIG", string("config/monad.json")));
        string memory path = string.concat("deployments/", vm.envOr("DEPLOY_ENV", string("fork")), ".json");
        string memory deployment = vm.readFile(path);
        address deployer = msg.sender;

        vm.startBroadcast();
        Redeployed memory r = redeploy(config, deployment, deployer, vm.envOr("FEE_RECIPIENT", deployer));
        address keeper = vm.envOr("KEEPER", address(0));
        if (keeper != address(0)) r.router.setKeeper(keeper, true);
        address owner = vm.envOr("OWNER", deployer);
        if (owner != deployer) r.router.transferOwnership(owner);
        vm.stopBroadcast();

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            vm.writeFile(path, updatedDeployment(deployment, r));
        }
    }

    function redeploy(string memory config, string memory deployment, address owner, address feeRecipient)
        public
        returns (Redeployed memory r)
    {
        require(vm.parseJsonUint(config, ".chainId") == block.chainid, "config is for another chain");
        require(vm.parseJsonUint(deployment, ".chainId") == block.chainid, "deployment is for another chain");
        IMorpho morpho = IMorpho(vm.parseJsonAddress(config, ".morpho"));
        IRiskManager risk = IRiskManager(vm.parseJsonAddress(deployment, ".riskManager"));
        uint256 feeBps = vm.parseJsonUint(config, ".feeBps");
        r.router = new MarginRouter(
            morpho, risk, vm.parseJsonAddressArray(config, ".swapTargets"), owner, feeRecipient, feeBps
        );
        r.router.setFees(feeBps, vm.parseJsonUint(config, ".keeperFeeBps"), feeRecipient);
        r.lens = new Lens(morpho, risk, r.router);
    }

    /// The same file with the new router and lens, and the old router appended to `previousRouters`.
    function updatedDeployment(string memory deployment, Redeployed memory r) public view returns (string memory) {
        string memory oldRouter = vm.toString(vm.parseJsonAddress(deployment, ".router"));
        string memory oldLens = vm.toString(vm.parseJsonAddress(deployment, ".lens"));
        string memory previous = string.concat('"', oldRouter, '"');
        if (vm.keyExistsJson(deployment, ".previousRouters")) {
            address[] memory earlier = vm.parseJsonAddressArray(deployment, ".previousRouters");
            for (uint256 i = earlier.length; i > 0; --i) {
                previous = string.concat('"', vm.toString(earlier[i - 1]), '",', previous);
            }
            deployment = _removeKey(deployment, earlier);
        }
        string memory out = vm.replace(deployment, oldRouter, vm.toString(address(r.router)));
        out = vm.replace(out, oldLens, vm.toString(address(r.lens)));
        return vm.replace(out, ',"markets":', string.concat(',"previousRouters":[', previous, '],"markets":'));
    }

    function _removeKey(string memory deployment, address[] memory earlier) internal pure returns (string memory) {
        string memory list;
        for (uint256 i; i < earlier.length; ++i) {
            list = string.concat(list, i == 0 ? "" : ",", '"', vm.toString(earlier[i]), '"');
        }
        return vm.replace(deployment, string.concat(',"previousRouters":[', list, "]"), "");
    }
}
