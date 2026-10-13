import { termsAcceptances, type Db } from "@levra/db";
import { termsAcceptRequest, termsMessage, type EligibilityResponse, type TermsAcceptResponse } from "@levra/shared/api";
import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import { ApiHttpError, upstream } from "../errors";

export type ComplianceOptions = {
  /** The terms version users must accept. Changing it asks everyone to accept again. */
  termsVersion: string;
  /** Request header with the visitor's ISO country code, set by the CDN in front of the API, for example `cf-ipcountry`. */
  countryHeader?: string;
  /** ISO 3166-1 alpha-2 codes, upper case. Decided with counsel (X-10). */
  blockedCountries: Set<string>;
};

export type Compliance = {
  regionBlocked(c: Context): boolean;
  country(c: Context): string | null;
  accepted(address: Address): Promise<boolean>;
  /** Throws REGION_BLOCKED or TERMS_NOT_ACCEPTED. Used before opening a position or depositing, never before closing. */
  require(c: Context, address: Address): Promise<void>;
};

export function createCompliance(db: Db, opts: ComplianceOptions): Compliance {
  const country = (c: Context) => {
    if (!opts.countryHeader) return null;
    const v = c.req.header(opts.countryHeader)?.trim().toUpperCase();
    return v && /^[A-Z]{2}$/.test(v) ? v : null;
  };
  // With a block list and a header to read, a request without a country is refused: it did not come through the CDN.
  const regionBlocked = (c: Context) => {
    if (opts.blockedCountries.size === 0) return false;
    const cc = country(c);
    return cc === null || opts.blockedCountries.has(cc);
  };
  const accepted = async (address: Address) =>
    (
      await db
        .select({ a: termsAcceptances.address })
        .from(termsAcceptances)
        .where(and(eq(termsAcceptances.address, address.toLowerCase()), eq(termsAcceptances.termsVersion, opts.termsVersion)))
    ).length > 0;

  return {
    regionBlocked,
    country,
    accepted,
    async require(c, address) {
      if (regionBlocked(c)) throw new ApiHttpError("REGION_BLOCKED", "Levra is not available in your region.");
      if (!(await upstream(() => accepted(address)))) throw new ApiHttpError("TERMS_NOT_ACCEPTED", `Accept the terms of use (version ${opts.termsVersion}) first.`);
    },
  };
}

/** Region and terms (BE-52). Smart wallets can accept too: viem checks ERC-1271 and ERC-6492 signatures on chain. */
export function complianceRoutes(db: Db, client: PublicClient, compliance: Compliance, opts: ComplianceOptions) {
  const app = new Hono();

  app.get("/v1/eligibility", async (c) => {
    const raw = c.req.query("address");
    if (raw !== undefined && !isAddress(raw, { strict: false })) throw new ApiHttpError("BAD_REQUEST", "Not an address.");
    const blocked = compliance.regionBlocked(c);
    return c.json({
      eligible: !blocked,
      reason: blocked ? "REGION_BLOCKED" : null,
      termsVersion: opts.termsVersion,
      termsAccepted: raw === undefined ? null : await upstream(() => compliance.accepted(getAddress(raw))),
    } satisfies EligibilityResponse);
  });

  app.post("/v1/terms/accept", async (c) => {
    const parsed = termsAcceptRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Expected an address, a terms version and a signature.");
    if (compliance.regionBlocked(c)) throw new ApiHttpError("REGION_BLOCKED", "Levra is not available in your region.");
    const { termsVersion, signature } = parsed.data;
    if (termsVersion !== opts.termsVersion) throw new ApiHttpError("BAD_REQUEST", `The current terms are version ${opts.termsVersion}.`);
    const address = getAddress(parsed.data.address);
    const valid = await upstream(() => client.verifyMessage({ address, message: termsMessage(termsVersion, address), signature }));
    if (!valid) throw new ApiHttpError("UNAUTHORIZED", "The signature does not match the terms text for this address.");

    const acceptedAt = new Date();
    await upstream(() =>
      db
        .insert(termsAcceptances)
        .values({ address: address.toLowerCase(), termsVersion, signature, country: compliance.country(c), acceptedAt })
        .onConflictDoNothing(),
    );
    const [row] = await upstream(() =>
      db.select().from(termsAcceptances).where(and(eq(termsAcceptances.address, address.toLowerCase()), eq(termsAcceptances.termsVersion, termsVersion))),
    );
    return c.json({ accepted: true, acceptedAt: Math.floor((row?.acceptedAt ?? acceptedAt).getTime() / 1000) } satisfies TermsAcceptResponse);
  });

  return app;
}
