import { receiptKeys, tapesendOutbox, type Db } from "@levra/db";
import { LEVRA_TAPEOUT_XLAYER, circuitsAbi, hubAbi, receiptEndpoint, sealReceipt } from "@levra/tapeout";
import { and, asc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { getAddress, parseEventLogs, type Account, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import type { Job } from "../runner";

/** Messages sent per run. One at a time, each mined before the next, so the key never has two transactions in flight. */
const BATCH = 10;
/** A sent transaction the node no longer knows after this long was dropped, and the message goes out again. */
const DROPPED_AFTER_MS = 10 * 60_000;
/** After this many failed tries a message waits for a person (lastError says why). */
const MAX_ATTEMPTS = 5;

type Row = typeof tapesendOutbox.$inferSelect;
const ZERO32: Hex = `0x${"0".repeat(64)}`;

export type SenderOptions = {
  client: PublicClient;
  /** The TapeOut key's wallet on X Layer: it holds the clock circuit NFT whose container sends. */
  wallet: WalletClient<Transport, Chain | undefined, Account>;
  intervalMs?: number;
  now?: () => number;
};

/**
 * Sends the queued TapeSend messages (BE-84) from Levra's clock container. Each message is sealed to the wallet's
 * receipt key as it is now; a wallet that removed its key gets nothing. The transaction hash is stored before waiting,
 * so a restart finishes the same transaction instead of sending a second one.
 */
export function createTapeSendSender({ client, wallet, intervalMs = 30_000, now = Date.now }: SenderOptions): Job {
  const { circuits, clockCircuitId, hub } = LEVRA_TAPEOUT_XLAYER;

  async function finish(db: Db, row: Row): Promise<"sent" | "pending" | "retry"> {
    const hash = row.txHash as Hex;
    const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    const where = and(eq(tapesendOutbox.address, row.address), eq(tapesendOutbox.key, row.key));
    if (receipt) {
      const [sent] = receipt.status === "success" ? parseEventLogs({ abi: hubAbi, eventName: "Sent", logs: receipt.logs }) : [];
      if (sent) {
        await db.update(tapesendOutbox).set({ inboxIndex: sent.args.inboxIndex.toString(), sentAt: new Date(now()), lastError: null }).where(where);
        return "sent";
      }
      await db.update(tapesendOutbox).set({ txHash: null, lastError: `transaction ${hash} reverted` }).where(where);
      return "retry";
    }
    const known = await client.getTransaction({ hash }).catch(() => null);
    if (known) return "pending";
    // Not mined and not known: dropped once it is old enough.
    if (row.txSentAt && now() - row.txSentAt.getTime() < DROPPED_AFTER_MS) return "pending";
    await db.update(tapesendOutbox).set({ txHash: null, lastError: `transaction ${hash} was dropped` }).where(where);
    return "retry";
  }

  return {
    name: "tapesend",
    intervalMs,
    async run({ db, logger }) {
      const owner = await client.readContract({ address: circuits, abi: circuitsAbi, functionName: "ownerOf", args: [clockCircuitId] });
      if (getAddress(owner) !== getAddress(wallet.account.address)) throw new Error(`the TapeOut key ${wallet.account.address} does not hold clock circuit ${clockCircuitId} (owner ${owner})`);

      let sent = 0;
      let pending = 0;
      const inFlight = await db.select().from(tapesendOutbox).where(and(isNull(tapesendOutbox.sentAt), isNotNull(tapesendOutbox.txHash)));
      for (const row of inFlight) {
        const r = await finish(db, row);
        if (r === "sent") sent += 1;
        if (r === "pending") pending += 1;
      }
      // Never start a new transaction while one is still out: they would share a nonce gap.
      if (pending > 0) return { sent, pending, waiting: null };

      const waiting = await db
        .select()
        .from(tapesendOutbox)
        .where(and(isNull(tapesendOutbox.sentAt), isNull(tapesendOutbox.txHash), lt(tapesendOutbox.attempts, MAX_ATTEMPTS)))
        .orderBy(asc(tapesendOutbox.createdAt))
        .limit(BATCH);

      for (const row of waiting) {
        const where = and(eq(tapesendOutbox.address, row.address), eq(tapesendOutbox.key, row.key));
        const key = (await db.select().from(receiptKeys).where(eq(receiptKeys.address, row.address)))[0];
        if (!key) {
          await db.update(tapesendOutbox).set({ attempts: MAX_ATTEMPTS, lastError: "the wallet has no receipt key" }).where(where);
          continue;
        }
        const to = getAddress(row.address);
        const payload = sealReceipt(to, key.publicKey as Hex, { subject: row.subject, body: row.body, ts: row.eventAt.getTime(), levra: row.levra });
        await db.update(tapesendOutbox).set({ attempts: sql`${tapesendOutbox.attempts} + 1`, publicKey: key.publicKey, payload }).where(where);
        let hash: Hex;
        try {
          hash = await wallet.writeContract({ address: hub, abi: hubAbi, functionName: "send", args: [circuits, clockCircuitId, receiptEndpoint(to), ZERO32, payload], chain: wallet.chain });
        } catch (err) {
          await db.update(tapesendOutbox).set({ lastError: err instanceof Error ? err.message.slice(0, 500) : String(err) }).where(where);
          logger.warn({ err, address: row.address, key: row.key }, "TapeSend message not sent; it will be retried");
          continue;
        }
        const txSentAt = new Date(now());
        await db.update(tapesendOutbox).set({ txHash: hash, txSentAt }).where(where);
        await client.waitForTransactionReceipt({ hash, timeout: 120_000 }).catch(() => null);
        const r = await finish(db, { ...row, txHash: hash, txSentAt });
        if (r === "sent") sent += 1;
        if (r === "pending") return { sent, pending: 1, waiting: waiting.length };
      }
      return { sent, pending: 0, waiting: waiting.length };
    },
  };
}
