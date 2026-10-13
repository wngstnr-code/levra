// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Morpho declares its events in a library, not in IMorpho. Importing it here makes the compiler
// emit them, so the ABI export can add them to the Morpho ABI without retyping a single one.
import {EventsLib} from "morpho-blue/src/libraries/EventsLib.sol";
