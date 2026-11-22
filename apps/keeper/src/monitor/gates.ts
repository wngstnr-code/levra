import { externalByChain, tokensByChain } from "@levra/shared/addresses";
import { coinbaseOracleRegistryAbi } from "@levra/shared/abis";
import type { ChainId } from "@levra/shared/chains";
import type { Deployment } from "@levra/shared/deployments";
import { stocksByChain } from "@levra/shared/markets";
import { keccak256, parseAbi, toBytes, type Address, type PublicClient } from "viem";

/**
 * Issuer controls that can block our markets (BE-75): a token pause, a blocklist that names Morpho or our contracts, an
 * oracle pause. Temporary ABIs until `packages/shared/abis` exports them (requested from Wangsit).
 */
const anchoredComplianceAbi = parseAbi(["function isDenylisted(address account) view returns (bool)"]);
const circleUsdcAbi = parseAbi(["function paused() view returns (bool)", "function isBlacklisted(address account) view returns (bool)"]);
const b20Abi = parseAbi(["function policyId(bytes32 policyScope) view returns (uint64)", "function isPaused(uint8 feature) view returns (bool)"]);
const b20PolicyRegistryAbi = parseAbi(["function isAuthorized(uint64 policyId, address account) view returns (bool)"]);
const xStockAbi = parseAbi(["function isPaused() view returns (bool)", "function asset() view returns (address)"]);
const sanctionsListAbi = parseAbi(["function isSanctioned(address account) view returns (bool)"]);

/** B20 feature 0 is transfer (05, SC-71). Mint, burn and seize do not stop a user's close. */
const B20_TRANSFER = 0;
const B20_SCOPES = ["TRANSFER_SENDER_POLICY", "TRANSFER_RECEIVER_POLICY", "TRANSFER_EXECUTOR_POLICY"].map((s) => keccak256(toBytes(s)));

/** One control: `blocked` is null when it could not be read. */
export type Gate = { key: string; blocked: boolean | null; message: string };

type Read = { key: string; label: string; call: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }; blockedWhen: (r: unknown) => boolean };

/** The contracts that must be able to hold and move the stock: Morpho, and our router and liquidator when deployed. */
export function watchedAccounts(chainId: ChainId, deployment?: Deployment): { name: string; address: Address }[] {
  const out: { name: string; address: Address }[] = [{ name: "Morpho", address: externalByChain[chainId].morpho }];
  if (deployment) out.push({ name: "router", address: deployment.router });
  if (deployment?.liquidator) out.push({ name: "liquidator", address: deployment.liquidator });
  return out;
}

async function run(client: PublicClient, reads: Read[]): Promise<Gate[]> {
  if (reads.length === 0) return [];
  const results = await client.multicall({ allowFailure: true, contracts: reads.map((r) => r.call) as never[] });
  return reads.map((r, i) => {
    const res = results[i]!;
    if (res.status !== "success") return { key: r.key, blocked: null, message: `${r.label} could not be read: ${res.error.message.split("\n")[0]}` };
    const blocked = r.blockedWhen(res.result);
    return { key: r.key, blocked, message: r.label };
  });
}

const isTrue = (r: unknown) => r === true;

/**
 * Circle's USDC on every chain (native on Monad, Base and X Layer): a pause, or a blacklist of Morpho or our contracts,
 * blocks every close and liquidation. The Earn vault holds the lenders' USDC, so a blacklist of it locks their funds.
 */
function usdcReads(chainId: ChainId, accounts: { name: string; address: Address }[], deployment?: Deployment): Read[] {
  const usdc = tokensByChain[chainId].USDC.address;
  const holders = deployment?.usdcVault ? [...accounts, { name: "USDC vault", address: deployment.usdcVault }] : accounts;
  return [
    { key: "gate:usdc-paused", label: "USDC is paused by Circle", call: { address: usdc, abi: circleUsdcAbi, functionName: "paused" }, blockedWhen: isTrue },
    ...holders.map((a) => ({
      key: `gate:usdc-blacklist:${a.name}`,
      label: `Circle blacklists ${a.name} (${a.address}) for USDC`,
      call: { address: usdc, abi: circleUsdcAbi, functionName: "isBlacklisted", args: [a.address] },
      blockedWhen: isTrue,
    })),
  ];
}

async function monadGates(client: PublicClient, accounts: { name: string; address: Address }[]): Promise<Gate[]> {
  const ext = externalByChain[143];
  return run(client, [
    ...accounts.map((a) => ({
      key: `gate:anchored-denylist:${a.name}`,
      label: `Anchored compliance denylists ${a.name} (${a.address}), so it cannot receive or send aQQQ, aHOOD or aBIL`,
      call: { address: ext.anchoredCompliance, abi: anchoredComplianceAbi, functionName: "isDenylisted", args: [a.address] },
      blockedWhen: isTrue,
    })),
  ]);
}

async function baseGates(client: PublicClient, accounts: { name: string; address: Address }[]): Promise<Gate[]> {
  const ext = externalByChain[8453];
  const stocks = Object.values(stocksByChain[8453]);
  const gates = await run(
    client,
    stocks.flatMap((s) => [
      { key: `gate:b20-paused:${s.symbol}`, label: `${s.tokenSymbol} transfers are paused by the issuer`, call: { address: s.token, abi: b20Abi, functionName: "isPaused", args: [B20_TRANSFER] }, blockedWhen: isTrue },
      {
        key: `gate:oracle-paused:${s.symbol}`,
        label: `The Coinbase oracle registry pauses ${s.tokenSymbol}; new positions stop and the closed limit applies (04)`,
        call: { address: ext.coinbaseOracleRegistry, abi: coinbaseOracleRegistryAbi, functionName: "getOracleParams", args: [s.token] },
        blockedWhen: (r) => (r as readonly [bigint, boolean])[1],
      },
    ]),
  );

  // The transfer policies of every stock, then whether each policy still lets our accounts through.
  const scopes = stocks.flatMap((s) => B20_SCOPES.map((scope) => ({ s, scope })));
  const ids = await client.multicall({ allowFailure: true, contracts: scopes.map(({ s, scope }) => ({ address: s.token, abi: b20Abi, functionName: "policyId", args: [scope] }) as const) });
  const policies = new Map<string, { id: bigint; tokens: Set<string> }>();
  ids.forEach((r, i) => {
    const { s } = scopes[i]!;
    if (r.status !== "success") {
      gates.push({ key: `gate:b20-policy-id:${s.symbol}`, blocked: null, message: `${s.tokenSymbol} transfer policy could not be read: ${r.error.message.split("\n")[0]}` });
      return;
    }
    const p = policies.get(String(r.result)) ?? { id: r.result as bigint, tokens: new Set<string>() };
    p.tokens.add(s.tokenSymbol);
    policies.set(String(r.result), p);
  });
  const policyGates = await run(
    client,
    [...policies.values()].flatMap((p) =>
      accounts.map((a) => ({
        key: `gate:b20-policy:${p.id}:${a.name}`,
        label: `Transfer policy ${p.id} (${[...p.tokens].join(", ")}) no longer authorizes ${a.name} (${a.address})`,
        call: { address: ext.b20PolicyRegistry, abi: b20PolicyRegistryAbi, functionName: "isAuthorized", args: [p.id, a.address] },
        blockedWhen: (r: unknown) => r === false,
      })),
    ),
  );
  return [...gates, ...policyGates];
}

async function xlayerGates(client: PublicClient, accounts: { name: string; address: Address }[]): Promise<Gate[]> {
  const ext = externalByChain[196];
  const stocks = Object.values(stocksByChain[196]);
  const underlying = await client.multicall({ allowFailure: true, contracts: stocks.map((s) => ({ address: s.token, abi: xStockAbi, functionName: "asset" }) as const) });
  return run(client, [
    ...stocks.flatMap((s, i) => {
      const reads: Read[] = [{ key: `gate:xstock-paused:${s.symbol}`, label: `${s.tokenSymbol} is paused by the issuer`, call: { address: s.token, abi: xStockAbi, functionName: "isPaused" }, blockedWhen: isTrue }];
      const u = underlying[i]!;
      if (u.status === "success") {
        reads.push({ key: `gate:xstock-paused:${s.symbol}x`, label: `${s.symbol}x, the token under ${s.tokenSymbol}, is paused by the issuer`, call: { address: u.result as Address, abi: xStockAbi, functionName: "isPaused" }, blockedWhen: isTrue });
      }
      return reads;
    }),
    ...accounts.map((a) => ({
      key: `gate:xstock-sanctions:${a.name}`,
      label: `The xStocks sanctions list names ${a.name} (${a.address}), so wrapped xStocks cannot move to or from it`,
      call: { address: ext.xStocksSanctionsList, abi: sanctionsListAbi, functionName: "isSanctioned", args: [a.address] },
      blockedWhen: isTrue,
    })),
  ]);
}

/** Every issuer control on one chain that could block a close, a liquidation or the price (BE-75, 04, 05). */
export async function readGates(client: PublicClient, chainId: ChainId, deployment?: Deployment): Promise<Gate[]> {
  const accounts = watchedAccounts(chainId, deployment);
  const [stock, usdc] = await Promise.all([
    chainId === 143 ? monadGates(client, accounts) : chainId === 8453 ? baseGates(client, accounts) : xlayerGates(client, accounts),
    run(client, usdcReads(chainId, accounts, deployment)),
  ]);
  return [...stock, ...usdc];
}
