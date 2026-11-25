import type { Address, Hex } from "viem";

export type SwapErrorCode = "NO_ROUTE" | "RATE_LIMITED" | "UPSTREAM_ERROR";

export class SwapError extends Error {
  constructor(
    readonly code: SwapErrorCode,
    message: string,
    readonly details?: unknown,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

export type SwapQuote = {
  amountIn: bigint;
  amountOut: bigint;
  /** Calldata for `target`, with `sender` as the one who pays and receives. */
  data: Hex;
  target: Address;
};

export type QuoteParams = { tokenIn: Address; tokenOut: Address; amountIn: bigint; sender: Address; slippageBps: number };
export type PriceParams = { tokenIn: Address; tokenOut: Address; amountIn: bigint };

export type SwapSource = {
  /** Route and calldata for selling `amountIn` of `tokenIn`, executed by `sender`. */
  quote(p: QuoteParams): Promise<SwapQuote>;
  /** Output for `amountIn` without building calldata. Used for the DEX mid price and market depth. */
  price(p: PriceParams): Promise<bigint>;
  /**
   * The same choice without the providers whose target is in `targets`, for a route that failed when executed (BE-102).
   * Absent on a single provider; quoting with nothing left throws NO_ROUTE.
   */
  without?(targets: readonly Address[]): SwapSource;
};

/** One way to swap on one chain. Our contracts call `target` and approve `spender` (`swapSpender` in `SwapTargets`). */
export type SwapProvider = SwapSource & {
  name: string;
  target: Address;
  spender: Address;
};
