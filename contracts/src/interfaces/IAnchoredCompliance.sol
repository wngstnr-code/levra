// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Anchored's compliance list on Monad: a denylisted account cannot send or receive aQQQ, aHOOD or aBIL.
interface IAnchoredCompliance {
    function isDenylisted(address account) external view returns (bool);
}
