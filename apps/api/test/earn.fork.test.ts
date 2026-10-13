import { external, tokens } from "@levra/shared/addresses";
import { morphoAbi } from "@levra/shared/abis";
import { earnAccount, earnResponse } from "@levra/shared/api";
import { toAssetsDown } from "@levra/shared/math";
import pino from "pino";
import { erc20Abi, erc4626Abi, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createChainClient } from "../src/chain/client";
import { createChainReader } from "../src/chain/reader";
import { marketOptionId, vaultOptionId } from "../src/earn/earn";
import type { EventStore, StoredEvent } from "../src/positions/events";
import { as, createForkClient, deal, forkDeployment, forkRpcUrl, onFork, randomAddress, send } from "./fork-helpers";

const vaultEvents = parseAbi([
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
]);

describe.skipIf(!onFork || !forkDeployment().usdcVault)("Earn read from the fork (BE-21)", () => {
  const deployment = forkDeployment();
  const vault = deployment.usdcVault as Address;
  const market = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "short")!;
  const chain = createForkClient(forkRpcUrl);
  const usdcLender = randomAddress();
  const stockLender = randomAddress();
  const deposited = parseUnits("100", 6);
  const stockSupplied = parseUnits("2", 18);

  let snapshotId: Hex;
  let fromBlock: bigint;

  /** The indexer's job, done from logs: the lenders' vault and Morpho lending events since the test began. */
  const events: EventStore = {
    async forUser(user) {
      const [vaultLogs, morphoLogs] = await Promise.all([
        chain.getLogs({ address: vault, events: vaultEvents, fromBlock, strict: true }),
        chain.getLogs({ address: external.morpho, events: morphoAbi.filter((i) => i.type === "event" && (i.name === "Supply" || i.name === "Withdraw")), fromBlock, strict: true }),
      ]);
      const stored = (source: StoredEvent["source"], marketId: Hex, l: { eventName: string; args: object; transactionHash: Hex; logIndex: number; blockNumber: bigint }): StoredEvent => ({
        source,
        name: l.eventName,
        marketId,
        txHash: l.transactionHash,
        logIndex: l.logIndex,
        blockNumber: l.blockNumber,
        blockTime: 0,
        args: Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, String(v)])),
      });
      return [
        ...vaultLogs.filter((l) => l.args.owner.toLowerCase() === user.toLowerCase()).map((l) => stored("vault", vault, l)),
        ...morphoLogs
          .filter((l) => String((l.args as { onBehalf: string }).onBehalf).toLowerCase() === user.toLowerCase())
          .map((l) => stored("morpho", (l.args as { id: Hex }).id, l)),
      ];
    },
  };
  /** A new app per check, so no cached read hides the latest block. */
  const get = async (path: string) => {
    const app = createApp({ logger: pino({ level: "silent" }), reader: createChainReader(createChainClient(forkRpcUrl), deployment), events });
    const res = await app.request(path);
    const body = await res.json();
    if (res.status !== 200) throw new Error(`${path} failed: ${JSON.stringify(body)}`);
    return body;
  };
  const params = () => chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "idToMarketParams", args: [market.marketId] });
  /**
   * Books the market's interest on chain, so the raw Morpho totals equal the expected ones the API computes. The gas is
   * set by hand: an estimate in the same second as the last update skips the accrual and runs short in the next block.
   */
  const accrue = async () => {
    const p = await params();
    await as(chain, stockLender, async () => {
      const hash = await chain.writeContract({ account: stockLender, chain: monad, address: external.morpho, abi: morphoAbi, functionName: "accrueInterest", args: [p], gas: 500_000n });
      expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
    });
  };

  beforeAll(async () => {
    snapshotId = await chain.snapshot();
    fromBlock = (await chain.getBlockNumber()) + 1n;
    await deal(chain, tokens.USDC.address, usdcLender, deposited);
    await as(chain, usdcLender, async () => {
      await send(chain, usdcLender, tokens.USDC.address, erc20Abi, "approve", [vault, deposited]);
      await send(chain, usdcLender, vault, erc4626Abi, "deposit", [deposited, usdcLender]);
    });
    const p = await params();
    await deal(chain, p.loanToken, stockLender, stockSupplied);
    await as(chain, stockLender, async () => {
      await send(chain, stockLender, p.loanToken, erc20Abi, "approve", [external.morpho, stockSupplied]);
      await send(chain, stockLender, external.morpho, morphoAbi, "supply", [p, stockSupplied, 0n, stockLender, "0x"]);
    });
  }, 120_000);
  afterAll(async () => {
    await chain.revert({ id: snapshotId });
  });

  it("lists the vault and the stock markets with the numbers on chain", { timeout: 60_000 }, async () => {
    await accrue();
    const { options } = earnResponse.parse(await get("/v1/earn"));
    const read = <T>(functionName: string, args: unknown[] = []) =>
      chain.readContract({ address: vault, abi: parseAbi(["function totalAssets() view returns (uint256)", "function fee() view returns (uint96)"]), functionName, args } as never) as Promise<T>;

    const v = options.find((o) => o.id === vaultOptionId(vault))!;
    expect(v).toMatchObject({ kind: "vault", asset: tokens.USDC.address, target: vault, marketId: null });
    // totalAssets accrues interest per second; the read is a block later than the API's.
    expect(BigInt(v.totalSuppliedRaw) <= (await read<bigint>("totalAssets"))).toBe(true);
    expect(BigInt(v.totalSuppliedRaw) >= deposited).toBe(true);
    expect(v.feeWad).toBe((await read<bigint>("fee")).toString());
    expect(BigInt(v.availableToWithdrawRaw) <= BigInt(v.totalSuppliedRaw)).toBe(true);

    const m = options.find((o) => o.id === marketOptionId(market.marketId))!;
    const raw = await chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "market", args: [market.marketId] });
    expect(m).toMatchObject({ kind: "market", asset: market.loanToken, assetSymbol: "aQQQ", target: external.morpho, feeWad: null });
    expect(m.totalSuppliedRaw).toBe(raw.totalSupplyAssets.toString());
    expect(m.availableToWithdrawRaw).toBe((raw.totalSupplyAssets - raw.totalBorrowAssets).toString());
    expect(options.filter((o) => o.kind === "market")).toHaveLength(deployment.markets.filter((x) => x.side === "short").length);
  });

  it("shows the vault lender's deposit, what it earned and what it can withdraw", { timeout: 60_000 }, async () => {
    const account = earnAccount.parse(await get(`/v1/earn/${usdcLender}`));
    const shares = await chain.readContract({ address: vault, abi: erc20Abi, functionName: "balanceOf", args: [usdcLender] });
    const supplied = await chain.readContract({ address: vault, abi: erc4626Abi, functionName: "convertToAssets", args: [shares] });
    const withdrawable = await chain.readContract({ address: vault, abi: erc4626Abi, functionName: "maxWithdraw", args: [usdcLender] });
    expect(account.positions).toEqual([
      { optionId: vaultOptionId(vault), suppliedRaw: supplied.toString(), earnedRaw: (supplied - deposited).toString(), withdrawableRaw: withdrawable.toString() },
    ]);
  });

  it("shows the stock lender's supply in the short market", { timeout: 60_000 }, async () => {
    await accrue();
    const account = earnAccount.parse(await get(`/v1/earn/${stockLender}`));
    const [raw, position] = await Promise.all([
      chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "market", args: [market.marketId] }),
      chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "position", args: [market.marketId, stockLender] }),
    ]);
    const supplied = toAssetsDown(position.supplyShares, raw.totalSupplyAssets, raw.totalSupplyShares);
    const liquidity = raw.totalSupplyAssets - raw.totalBorrowAssets;
    expect(account.positions).toEqual([
      {
        optionId: marketOptionId(market.marketId),
        suppliedRaw: supplied.toString(),
        earnedRaw: (supplied - stockSupplied).toString(),
        withdrawableRaw: (supplied < liquidity ? supplied : liquidity).toString(),
      },
    ]);
  });
});
