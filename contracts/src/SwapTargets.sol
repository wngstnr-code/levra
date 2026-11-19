// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// The contracts swap calldata may be sent to: one to three, set at deployment and never changeable,
/// so nobody can point a swap at Morpho, a token or anything else (threat T-01, D-79). Each target has
/// a fixed spender, the address approved for the swap amount: the target itself, or a separate approve
/// contract for aggregators that pull through one, such as OKX DEX (D-88).
abstract contract SwapTargets {
    uint256 public constant MAX_SWAP_TARGETS = 3;

    address private immutable TARGET_0;
    address private immutable TARGET_1;
    address private immutable TARGET_2;
    address private immutable SPENDER_0;
    address private immutable SPENDER_1;
    address private immutable SPENDER_2;

    error InvalidSwapTargets();

    /// `forbidden` is Morpho, which must never receive arbitrary calldata or an approval. A zero spender
    /// means the target itself.
    constructor(address[] memory targets, address[] memory spenders, address forbidden) {
        uint256 n = targets.length;
        if (n == 0 || n > MAX_SWAP_TARGETS || spenders.length != n) revert InvalidSwapTargets();
        address[3] memory s;
        for (uint256 i; i < n; ++i) {
            address t = targets[i];
            if (t == address(0) || t == forbidden) revert InvalidSwapTargets();
            for (uint256 j; j < i; ++j) {
                if (targets[j] == t) revert InvalidSwapTargets();
            }
            s[i] = spenders[i] == address(0) ? t : spenders[i];
            if (s[i] == forbidden) revert InvalidSwapTargets();
        }
        TARGET_0 = targets[0];
        TARGET_1 = n > 1 ? targets[1] : address(0);
        TARGET_2 = n > 2 ? targets[2] : address(0);
        (SPENDER_0, SPENDER_1, SPENDER_2) = (s[0], s[1], s[2]);
    }

    /// The address approved when swapping through `target`, or zero for an address that is not a target.
    function swapSpender(address target) public view returns (address) {
        if (target == address(0)) return address(0);
        if (target == TARGET_0) return SPENDER_0;
        if (target == TARGET_1) return SPENDER_1;
        if (target == TARGET_2) return SPENDER_2;
        return address(0);
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
