// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Swap targets and spenders are fixed at deployment (D-79, D-88). A target or spender that is one of the
/// deployment's tokens would let swap calldata move the router's balance in the middle of a transaction
/// (BE-94 finding 3), so the deploy scripts refuse it before anything is created.
library SwapTargetGuard {
    function check(address[] memory targets, address[] memory spenders, address[] memory tokens) internal pure {
        for (uint256 i; i < targets.length; ++i) {
            for (uint256 j; j < tokens.length; ++j) {
                require(targets[i] != tokens[j], "swap target is a token");
                require(spenders[i] != tokens[j], "swap spender is a token");
            }
        }
    }
}
