import { z } from "zod";
import { bytes32, priceE8, rawAmount, symbol, unixSeconds, wad } from "./primitives";
import { sessionInfo } from "./session";

export const priceEvent = z.object({
  symbol,
  oraclePriceE8: priceE8,
  publishedAt: unixSeconds,
  stale: z.boolean(),
  dexMidPriceE8: priceE8.nullable(),
});
export type PriceEvent = z.infer<typeof priceEvent>;

export const sessionEvent = sessionInfo;
export type SessionEvent = z.infer<typeof sessionEvent>;

export const marketEvent = z.object({
  marketId: bytes32,
  currentSoftLtvWad: wad,
  borrowApyWad: wad,
  availableLiquidityRaw: rawAmount,
});
export type MarketEvent = z.infer<typeof marketEvent>;

export const streamEvents = {
  price: priceEvent,
  session: sessionEvent,
  market: marketEvent,
} as const;
export type StreamEventName = keyof typeof streamEvents;
