import type { vaultEvents } from "@levra/db";
import { decodeEventLog, parseAbi, toEventSelector, type Hex } from "viem";
import type { RawLog } from "./sources/types";

/**
 * The USDC vault is a MetaMorpho vault: plain ERC-4626 `Deposit` and `Withdraw` events (BE-22). Written out with the
 * EIP-4626 names because viem's `erc4626Abi` calls the second `Deposit` topic `receiver`, and it is the share owner.
 */
export const vaultEventsAbi = parseAbi([
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
]);
export const vaultTopics: Hex[] = vaultEventsAbi.map((item) => toEventSelector(item));

function plain(value: unknown): string | number | boolean {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).toLowerCase();
}

/** `user` is the owner of the vault shares: who deposited for themselves or whose shares were redeemed. */
export function toVaultRow(log: RawLog): typeof vaultEvents.$inferInsert {
  const decoded = decodeEventLog({ abi: vaultEventsAbi, data: log.data, topics: log.topics, strict: true });
  const args = decoded.args as Record<string, unknown>;
  return {
    name: decoded.eventName,
    vault: log.address.toLowerCase(),
    user: String(args.owner).toLowerCase(),
    args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, plain(v)])),
    blockNumber: log.blockNumber,
    blockTime: new Date(log.blockTime * 1000),
    txHash: log.txHash.toLowerCase(),
    logIndex: log.logIndex,
  };
}
