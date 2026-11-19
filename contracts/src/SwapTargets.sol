// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// The contracts swap calldata may be sent to: one to three, set at deployment and never changeable,
/// so nobody can point a swap at Morpho, a token or anything else (threat T-01, D-79).
abstract contract SwapTargets {
    uint256 public constant MAX_SWAP_TARGETS = 3;

    address private immutable TARGET_0;
    address private immutable TARGET_1;
    address private immutable TARGET_2;

    error InvalidSwapTargets();

    /// `forbidden` is Morpho, which must never receive arbitrary calldata.
    constructor(address[] memory targets, address forbidden) {
        uint256 n = targets.length;
        if (n == 0 || n > MAX_SWAP_TARGETS) revert InvalidSwapTargets();
        for (uint256 i; i < n; ++i) {
            address t = targets[i];
            if (t == address(0) || t == forbidden) revert InvalidSwapTargets();
            for (uint256 j; j < i; ++j) {
                if (targets[j] == t) revert InvalidSwapTargets();
            }
        }
        TARGET_0 = targets[0];
        TARGET_1 = n > 1 ? targets[1] : address(0);
        TARGET_2 = n > 2 ? targets[2] : address(0);
    }

    function swapTargets() external view returns (address[] memory targets) {
        uint256 n = TARGET_2 != address(0) ? 3 : TARGET_1 != address(0) ? 2 : 1;
        targets = new address[](n);
        targets[0] = TARGET_0;
        if (n > 1) targets[1] = TARGET_1;
        if (n > 2) targets[2] = TARGET_2;
    }

    function _isSwapTarget(address target) internal view returns (bool) {
        return target != address(0) && (target == TARGET_0 || target == TARGET_1 || target == TARGET_2);
    }
}
