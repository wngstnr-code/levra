// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Id, IMorpho, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMetaMorpho, IMetaMorphoFactory} from "../src/interfaces/IMetaMorpho.sol";

/// How the USDC vault is created and configured. Shared by the deployment script and its test.
library VaultPlan {
    string internal constant NAME = "Levra USDC";
    string internal constant SYMBOL = "lvUSDC";
    /// 10% of interest, as decided in D-28.
    uint256 internal constant FEE = 0.1e18;
    /// Changes that loosen the vault wait this long once the vault is set up.
    uint256 internal constant TIMELOCK = 1 days;

    /// Creates the vault owned by the caller, enables the given markets in order and sets the fee.
    /// Supply caps come from the chain config (config/<chain>.json, `vaultCaps`), from docs/04-risk-rules.md.
    function create(
        IMetaMorphoFactory factory,
        IMorpho morpho,
        address usdc,
        Id[] memory ids,
        uint256[] memory caps,
        address feeRecipient,
        bytes32 salt
    ) internal returns (IMetaMorpho vault) {
        vault = factory.createMetaMorpho(msg.sender, 0, usdc, NAME, SYMBOL, salt);
        for (uint256 i; i < ids.length; ++i) {
            MarketParams memory mp = morpho.idToMarketParams(ids[i]);
            vault.submitCap(mp, caps[i]);
            vault.acceptCap(mp);
        }
        vault.setSupplyQueue(ids);
        vault.setFeeRecipient(feeRecipient);
        vault.setFee(FEE);
        vault.submitTimelock(TIMELOCK);
    }
}
