import { xlayerExternal, xlayerTapeout } from "@levra/shared/addresses";

/**
 * Levra's TapeOut processor on X Layer (BE-82, D-113), in the shape the TapeSend code uses. The addresses come from
 * `@levra/shared/addresses`. Circuit 1 is the Wall Street Clock and its container is the one TapeSend sender.
 */
export const LEVRA_TAPEOUT_XLAYER = {
  chainId: 196,
  circuits: xlayerTapeout.processor,
  hub: xlayerExternal.tapesendHub,
  clockCircuitId: BigInt(xlayerTapeout.circuits.wallStreetClock),
  /** The ERC-6551 container of the clock circuit: the `from` of every receipt. */
  container: xlayerTapeout.clockContainer,
  /** The TapeOut key: holds the circuit NFTs and signs the sends. */
  sender: xlayerTapeout.operator,
} as const;
