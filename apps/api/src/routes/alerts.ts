import { alertSettings as alertSettingsTable, telegramLinks, type Db } from "@levra/db";
import { alertSettingsUpdate, type AlertSettings, type TelegramLinkResponse } from "@levra/shared/api";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { ApiHttpError, upstream } from "../errors";
import { requireWallet, type AuthVariables } from "./auth";

/** Initial proposal: a Telegram link code is good for 15 minutes. */
export const TELEGRAM_LINK_TTL_SECONDS = 900;

/** What a wallet that never saved settings gets: every event on, no channel yet. */
export const DEFAULT_EVENTS: AlertSettings["events"] = { preClose: true, ltvThresholdWad: null, autoDeleverage: true, liquidation: true, depositArrived: true };

type Row = typeof alertSettingsTable.$inferSelect;

export function toAlertSettings(row: Row | undefined): AlertSettings {
  if (!row) return { channels: { email: null, telegramLinked: false }, events: DEFAULT_EVENTS };
  return {
    channels: { email: row.email, telegramLinked: row.telegramChatId !== null },
    events: {
      preClose: row.preClose,
      ltvThresholdWad: row.ltvThresholdWad,
      autoDeleverage: row.autoDeleverage,
      liquidation: row.liquidation,
      depositArrived: row.depositArrived,
    },
  };
}

export type AlertRouteOptions = { secret: string; telegramBot?: string };

/** User alert settings (BE-33). Every route needs a wallet sign-in; a wallet only ever sees and changes its own row. */
export function alertRoutes(db: Db, opts: AlertRouteOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("/v1/alerts", requireWallet(opts.secret));
  app.use("/v1/alerts/*", requireWallet(opts.secret));

  const load = async (address: string) => (await db.select().from(alertSettingsTable).where(eq(alertSettingsTable.address, address)))[0];

  app.get("/v1/alerts", async (c) => c.json(toAlertSettings(await upstream(() => load(c.var.wallet.toLowerCase())))));

  app.put("/v1/alerts", async (c) => {
    const parsed = alertSettingsUpdate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid alert settings.", parsed.error.issues);
    const threshold = parsed.data.events?.ltvThresholdWad;
    if (threshold !== undefined && threshold !== null && (BigInt(threshold) === 0n || BigInt(threshold) >= 10n ** 18n)) {
      throw new ApiHttpError("BAD_REQUEST", "The LTV threshold must be above 0 and below 100%.");
    }
    const address = c.var.wallet.toLowerCase();
    const current = toAlertSettings(await upstream(() => load(address)));
    const events = { ...current.events, ...parsed.data.events };
    const email = parsed.data.channels?.email !== undefined ? parsed.data.channels.email : current.channels.email;
    const now = new Date();
    const values = {
      email,
      preClose: events.preClose,
      ltvThresholdWad: events.ltvThresholdWad,
      autoDeleverage: events.autoDeleverage,
      liquidation: events.liquidation,
      depositArrived: events.depositArrived,
      updatedAt: now,
    };
    await upstream(() =>
      db
        .insert(alertSettingsTable)
        .values({ address, telegramChatId: null, createdAt: now, ...values })
        .onConflictDoUpdate({ target: alertSettingsTable.address, set: values }),
    );
    return c.json(toAlertSettings(await upstream(() => load(address))));
  });

  app.post("/v1/alerts/telegram", async (c) => {
    if (!opts.telegramBot) throw new ApiHttpError("NOT_FOUND", "Telegram alerts are not set up on this server.");
    // Telegram allows up to 64 characters of A-Z, a-z, 0-9, _ and - in a start parameter.
    const code = randomBytes(24).toString("base64url");
    await upstream(() => db.insert(telegramLinks).values({ code, address: c.var.wallet.toLowerCase(), createdAt: new Date() }));
    const expiresAt = Math.floor(Date.now() / 1000) + TELEGRAM_LINK_TTL_SECONDS;
    return c.json({ url: `https://t.me/${opts.telegramBot}?start=${code}`, expiresAt } satisfies TelegramLinkResponse);
  });

  app.delete("/v1/alerts/telegram", async (c) => {
    const address = c.var.wallet.toLowerCase();
    await upstream(() => db.update(alertSettingsTable).set({ telegramChatId: null, updatedAt: sql`now()` }).where(eq(alertSettingsTable.address, address)));
    return c.json(toAlertSettings(await upstream(() => load(address))));
  });

  return app;
}
