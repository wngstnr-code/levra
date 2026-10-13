// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Id, IMorpho, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMetaMorpho, IMetaMorphoFactory} from "../src/interfaces/IMetaMorpho.sol";

/// How the USDC vault is created and configured. Shared by the deployment script and its test.
library VaultPlan {
    IMetaMorphoFactory internal constant FACTORY = IMetaMorphoFactory(0x33f20973275B2F574488b18929cd7DCBf1AbF275);
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    string internal constant NAME = "Levra USDC";
    string internal constant SYMBOL = "lvUSDC";
    /// 10% of interest, as decided in D-28.
    uint256 internal constant FEE = 0.1e18;
    /// Changes that loosen the vault wait this long once the vault is set up.
    uint256 internal constant TIMELOCK = 1 days;

    /// Supply caps per stock, from docs/04-risk-rules.md. Initial proposals.
    function capFor(bytes32 symbolHash) internal pure returns (uint256) {
        if (symbolHash == keccak256("BIL")) return 20_000e6;
        if (symbolHash == keccak256("QQQ")) return 10_000e6;
        if (symbolHash == keccak256("HOOD")) return 5_000e6;
        return 0;
    }

    /// Creates the vault owned by the caller, enables the given markets in order and sets the fee.
    function create(IMorpho morpho, Id[] memory ids, uint256[] memory caps, address feeRecipient, bytes32 salt)
        internal
        returns (IMetaMorpho vault)
    {
        vault = FACTORY.createMetaMorpho(msg.sender, 0, USDC, NAME, SYMBOL, salt);
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
