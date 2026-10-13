import { z } from "zod";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

const matches = <T extends string>(pattern: RegExp) =>
  z.custom<T>((value) => typeof value === "string" && pattern.test(value));

export const address = matches<Address>(/^0x[0-9a-fA-F]{40}$/);
export const hex = matches<Hex>(/^0x([0-9a-fA-F]{2})*$/);
export const bytes32 = matches<Hex>(/^0x[0-9a-fA-F]{64}$/);

/** Non-negative integer in base units, as a decimal string. */
export const rawAmount = z.string().regex(/^(0|[1-9][0-9]*)$/);
/** Integer in base units that may be negative, as a decimal string. */
export const signedRawAmount = z.string().regex(/^(0|-?[1-9][0-9]*)$/);
/** 1e18 means 100%. */
export const wad = rawAmount;
/** Dollar price with 8 decimals. */
export const priceE8 = rawAmount;
/** USDC base units, 6 decimals. */
export const usdRaw = rawAmount;
export const signedUsdRaw = signedRawAmount;

export const bps = z.number().int().min(0).max(10_000);
export const signedBps = z.number().int();
export const leverageE2 = z.number().int().positive();
export const unixSeconds = z.number().int().nonnegative();

/** Uppercase stock symbol without the `a` prefix, for example QQQ. */
export const symbol = z.string().regex(/^[A-Z][A-Z0-9.]{0,9}$/);

export const sideName = z.enum(["long", "short"]);
export type SideName = z.infer<typeof sideName>;

export const sessionName = z.enum(["UNKNOWN", "PRE_MARKET", "REGULAR", "POST_MARKET", "OVERNIGHT", "CLOSED"]);
export type SessionName = z.infer<typeof sessionName>;
