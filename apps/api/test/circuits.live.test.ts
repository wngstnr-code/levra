import { xlayerDeployment } from "@levra/shared/deployments/xlayer";
import { createPublicClient, http, type PublicClient } from "viem";
import { xLayer } from "viem/chains";
import { describe, expect, it } from "vitest";
import { actionCircuitCheck } from "../src/chain/action-check";
import { createChainReader } from "../src/chain/reader";

/**
 * BE-83 and BE-86 against Levra's real circuits on X Layer mainnet: every market finds the circuit holding its limits, the
 * answers agree with math.ts, and the clock agrees with calendar.ts. Read only. Run with XLAYER_LIVE=1; XLAYER_RPC_URL
 * defaults to rpc.xlayer.tech, which takes the large `eval` calls (some ISPs block the okx.com endpoint).
 */
const live = process.env.XLAYER_LIVE === "1";

describe.skipIf(!live)("TapeOut circuits on X Layer mainnet (BE-83, BE-86)", () => {
  const client = createPublicClient({ chain: xLayer, transport: http(process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech") }) as PublicClient;
  const reader = createChainReader(client, xlayerDeployment);

  it("answers for every market from the circuit of its limits", async () => {
    const markets = await reader.markets();
    expect(markets.length).toBeGreaterThan(0);
    for (const m of markets) {
      const value = 1_000n * 10n ** 6n;
      // Half the hard limit is healthy and under every soft limit; just past the hard limit is not healthy.
      const safe = await reader.circuits!.risk(m, { debt: (value * m.lltvWad) / 2n / 10n ** 18n, value });
      const over = await reader.circuits!.risk(m, { debt: (value * m.lltvWad) / 10n ** 18n + 1n, value });
      expect(safe, `${m.info.symbol} ${m.info.side}`).toMatchObject({ healthy: true, belowSoftLimit: true, matches: true });
      expect(over, `${m.info.symbol} ${m.info.side}`).toMatchObject({ healthy: false, matches: true });
    }
  }, 180_000);

  it("checks a prepared open with the real circuits (BE-87)", async () => {
    const m = (await reader.markets()).find((x) => x.info.side === "long" && x.oraclePriceE8 > 0n)!;
    const user = "0x00000000000000000000000000000000000a6e77";
    const open = { kind: "open", request: { user, symbol: m.info.symbol, side: "long", marginRaw: "50000000", leverageE2: 150, slippageBps: 50 } } as const;
    // One share as collateral and a fifth of its value as debt: healthy and under every soft limit.
    const value = (m.oraclePriceE8 * 10n ** 6n) / 10n ** 8n;
    const quote = { market: { marketId: m.info.marketId }, preview: { collateralRaw: (10n ** BigInt(m.info.stock.decimals)).toString(), debtRaw: (value / 5n).toString() } };
    const check = await actionCircuitCheck(reader, open, quote, Date.now());
    expect(check).toMatchObject({ risk: { healthy: true, belowSoftLimit: true, matches: true }, gap: null, clock: { matches: true } });
  }, 60_000);

  it("reads the clock and agrees with calendar.ts", async () => {
    const now = Math.floor(Date.now() / 1_000);
    expect(await reader.circuits!.clock(now)).toMatchObject({ circuitId: 1, matches: true });
  }, 60_000);
});
