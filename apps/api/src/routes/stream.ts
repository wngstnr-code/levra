import type { MarketEvent, PriceEvent, SessionEvent, StreamEventName } from "@levra/shared/api";
import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { ChainReader } from "../chain/reader";
import type { Logger } from "../logger";
import { noDexMids, toApiMarket, toSessionInfo, type DexMids } from "./markets";

export type StreamOptions = { pollMs?: number; keepAliveMs?: number };

type Snapshot = { prices: Map<string, PriceEvent>; markets: Map<string, MarketEvent>; session: SessionEvent | null };

/** Changed items between two reads, compared without timestamps that move on every read. */
export async function readEvents(reader: ChainReader, previous: Snapshot, dexMids: DexMids = noDexMids) {
  const [markets, chainSession, mids] = await Promise.all([reader.markets(), reader.session(), dexMids()]);
  const next: Snapshot = { prices: new Map(), markets: new Map(), session: toSessionInfo(chainSession) };
  const events: { event: StreamEventName; data: unknown }[] = [];

  for (const m of markets) {
    const api = toApiMarket(m, mids.get(m.info.symbol));
    const price: PriceEvent = {
      symbol: api.symbol,
      oraclePriceE8: api.oraclePriceE8,
      feedUpdatedAt: api.oracleFeedUpdatedAt,
      publishedAt: api.oraclePublishedAt,
      stale: api.oracleStale,
      dexMidPriceE8: api.dexMidPriceE8,
    };
    if (!next.prices.has(price.symbol)) {
      next.prices.set(price.symbol, price);
      if (JSON.stringify(previous.prices.get(price.symbol)) !== JSON.stringify(price)) events.push({ event: "price", data: price });
    }
    const market: MarketEvent = {
      marketId: api.marketId,
      currentSoftLtvWad: api.currentSoftLtvWad,
      borrowApyWad: api.borrowApyWad,
      availableLiquidityRaw: api.availableLiquidityRaw,
    };
    next.markets.set(market.marketId, market);
    if (JSON.stringify(previous.markets.get(market.marketId)) !== JSON.stringify(market)) events.push({ event: "market", data: market });
  }

  const { updatedAt: _, ...sessionNow } = next.session ?? ({} as SessionEvent);
  const { updatedAt: __, ...sessionBefore } = previous.session ?? ({} as SessionEvent);
  if (JSON.stringify(sessionNow) !== JSON.stringify(sessionBefore)) events.push({ event: "session", data: next.session });

  return { next, events };
}

const emptySnapshot = (): Snapshot => ({ prices: new Map(), markets: new Map(), session: null });

export function streamRoutes(reader: ChainReader, logger: Logger, { pollMs = 2_000, keepAliveMs = 15_000 }: StreamOptions = {}, dexMids: DexMids = noDexMids) {
  const app = new Hono();

  app.get("/v1/stream", (c) =>
    streamSSE(c, async (stream: SSEStreamingApi) => {
      let snapshot = emptySnapshot();
      let lastSent = Date.now();
      while (!stream.aborted) {
        try {
          const { next, events } = await readEvents(reader, snapshot, dexMids);
          snapshot = next;
          for (const e of events) await stream.writeSSE({ event: e.event, data: JSON.stringify(e.data) });
          if (events.length > 0) lastSent = Date.now();
        } catch (err) {
          logger.warn({ err }, "stream read failed");
        }
        if (Date.now() - lastSent >= keepAliveMs) {
          await stream.write(": keep-alive\n\n");
          lastSent = Date.now();
        }
        await stream.sleep(pollMs);
      }
    }),
  );

  return app;
}
