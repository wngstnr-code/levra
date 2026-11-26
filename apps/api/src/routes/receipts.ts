import { receiptKeys, tapesendOutbox, type Db } from "@levra/db";
import { receiptKeyRequest, type ReceiptKeyResponse, type ReceiptsResponse } from "@levra/shared/api";
import { LEVRA_TAPEOUT_XLAYER, TapeSendError, assertValidPublicKey } from "@levra/tapeout";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { hexToBytes, type Hex } from "viem";
import { ApiHttpError, upstream } from "../errors";
import { requireWallet, type AuthVariables } from "./auth";

const sender = { chainId: 196 as const, hub: LEVRA_TAPEOUT_XLAYER.hub, container: LEVRA_TAPEOUT_XLAYER.container };
const LIMIT = 50;

/**
 * Private trade receipts (BE-84). A wallet registers the public half of its receipt key and reads the receipts sent to
 * it. Every route needs a wallet sign-in; a wallet only sees and changes its own key and receipts.
 */
export function receiptRoutes(db: Db, opts: { secret: string }) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("/v1/receipts", requireWallet(opts.secret));
  app.use("/v1/receipts/*", requireWallet(opts.secret));

  const keyOf = async (address: string): Promise<ReceiptKeyResponse> => {
    const row = (await upstream(() => db.select().from(receiptKeys).where(eq(receiptKeys.address, address))))[0];
    return { key: row ? { publicKey: row.publicKey as Hex, keyIndex: row.keyIndex } : null, sender };
  };

  app.get("/v1/receipts/key", async (c) => c.json(await keyOf(c.var.wallet.toLowerCase())));

  app.put("/v1/receipts/key", async (c) => {
    const parsed = receiptKeyRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid receipt key.", parsed.error.issues);
    try {
      assertValidPublicKey(hexToBytes(parsed.data.publicKey));
    } catch (e) {
      if (e instanceof TapeSendError) throw new ApiHttpError("BAD_REQUEST", "Not a usable X25519 public key.");
      throw e;
    }
    const address = c.var.wallet.toLowerCase();
    const now = new Date();
    const values = { publicKey: parsed.data.publicKey.toLowerCase(), keyIndex: parsed.data.keyIndex, updatedAt: now };
    await upstream(() => db.insert(receiptKeys).values({ address, createdAt: now, ...values }).onConflictDoUpdate({ target: receiptKeys.address, set: values }));
    return c.json(await keyOf(address));
  });

  // Receipts already sent stay onchain; deleting the key only stops new ones.
  app.delete("/v1/receipts/key", async (c) => {
    const address = c.var.wallet.toLowerCase();
    await upstream(() => db.delete(receiptKeys).where(eq(receiptKeys.address, address)));
    return c.json(await keyOf(address));
  });

  app.get("/v1/receipts", async (c) => {
    const address = c.var.wallet.toLowerCase();
    const rows = await upstream(() =>
      db
        .select()
        .from(tapesendOutbox)
        .where(and(eq(tapesendOutbox.address, address), isNotNull(tapesendOutbox.sentAt)))
        .orderBy(desc(tapesendOutbox.sentAt))
        .limit(LIMIT),
    );
    const items = rows.map((r) => ({
      id: r.key,
      txHash: r.txHash as Hex,
      inboxIndex: r.inboxIndex!,
      payload: r.payload as Hex,
      sentAt: Math.floor(r.sentAt!.getTime() / 1000),
    }));
    return c.json({ sender, items } satisfies ReceiptsResponse);
  });

  return app;
}
