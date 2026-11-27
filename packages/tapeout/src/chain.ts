import { erc20Abi, numberToHex, parseAbi, parseEventLogs, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";

export const factoryAbi = parseAbi([
  "function createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address transistors, address circuits)",
  "function deployFee() view returns (uint256)",
  "function bem() view returns (address)",
  "function protocolFee() view returns (uint256)",
  "function isCPU(address circuits) view returns (bool)",
  "function cpuCount() view returns (uint256)",
  "event CPUCreated(address indexed circuits, address indexed transistors, address indexed creator, string name, uint256 supply, uint256 mintPrice)",
]);

export const transistorsAbi = parseAbi([
  "function mint(uint256 id, uint256 amount) payable",
  "function mintPrice() view returns (uint256)",
  "function protocolFee() view returns (uint256)",
  "function supplyCap() view returns (uint256)",
  "function minted() view returns (uint256)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);

export const circuitsAbi = parseAbi([
  "function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256 id)",
  "function TAPEOUT_FEE() view returns (uint256)",
  "function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)",
  "function netlist(uint256 id) view returns (bytes)",
  "function eval(uint256 id, bytes inputs) view returns (bytes)",
  "function ownerOf(uint256 id) view returns (address)",
  "function transferFrom(address from, address to, uint256 id)",
  "function transistors() view returns (address)",
  "event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)",
]);

export const openerAbi = parseAbi([
  "function open(address circuits, uint256 id) payable returns (address)",
  "function accountOf(address circuits, uint256 id) view returns (address)",
  "function FEE() view returns (uint256)",
]);

export const hubAbi = parseAbi([
  "function send(address circuits, uint256 tokenId, bytes32 to, bytes32 ref, bytes payload) returns (uint256 inboxIndex)",
  "function inboxCount(bytes32 to) view returns (uint256)",
  "function outboxCount(address from) view returns (uint256)",
  "function accountOf(address circuits, uint256 tokenId) view returns (address)",
  "event Sent(bytes32 indexed to, address indexed from, bytes32 indexed ref, uint256 inboxIndex, uint256 outboxIndex, bytes payload)",
]);

/** The TapeOut contracts of one chain (05). */
export type TapeOutContracts = { factory: Address; opener: Address; hub: Address };

export type TapeOutClients = { client: PublicClient; wallet: WalletClient<Transport, Chain | undefined, Account> };

/** A TapeSend endpoint: uint32(0) ‖ uint64(chainId) ‖ container. */
export const endpointId = (chainId: number, container: Address): Hex => numberToHex((BigInt(chainId) << 160n) | BigInt(container), { size: 32 });

const ZERO32: Hex = `0x${"0".repeat(64)}`;

async function confirm(client: PublicClient, sent: Promise<Hex>) {
  const hash = await sent;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return receipt;
}

/**
 * Since the factory upgrade of 8 November 2026 a processor costs `deployFee` in the BEM token (8 decimals), pulled with
 * `transferFrom`, and `createCPU` refuses OKB (05). Every fee is read live: the factory is upgradeable.
 */
export async function createProcessor(
  { client, wallet }: TapeOutClients,
  factory: Address,
  p: { name: string; symbol: string; story: string; supply: bigint; mintPrice: bigint },
) {
  const [fee, bem] = await Promise.all([
    client.readContract({ address: factory, abi: factoryAbi, functionName: "deployFee" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "bem" }),
  ]);
  await allowBem({ client, wallet }, bem, factory, fee);
  const receipt = await confirm(
    client,
    wallet.writeContract({ address: factory, abi: factoryAbi, functionName: "createCPU", args: [p.name, p.symbol, p.story, p.supply, p.mintPrice], chain: wallet.chain }),
  );
  const [created] = parseEventLogs({ abi: factoryAbi, eventName: "CPUCreated", logs: receipt.logs });
  if (!created) throw new Error("no CPUCreated event");
  return { circuits: created.args.circuits, transistors: created.args.transistors, hash: receipt.transactionHash, gasUsed: receipt.gasUsed, bemFee: fee };
}

async function allowBem({ client, wallet }: TapeOutClients, bem: Address, spender: Address, amount: bigint) {
  const owner = wallet.account.address;
  const balance = await client.readContract({ address: bem, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  if (balance < amount) throw new Error(`${owner} holds ${balance} BEM units and needs ${amount}`);
  const allowed = await client.readContract({ address: bem, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
  if (allowed < amount) await confirm(client, wallet.writeContract({ address: bem, abi: erc20Abi, functionName: "approve", args: [spender, amount], chain: wallet.chain }));
}

/**
 * Mints NAND (id 0) transistors on a processor created since 8 November 2026: `amount * mintPrice + protocolFee` in BEM,
 * pulled with `transferFrom`. The protocol fee is per call, not per transistor.
 */
export async function mintNand({ client, wallet }: TapeOutClients, factory: Address, transistors: Address, amount: bigint) {
  const read = (functionName: "mintPrice" | "protocolFee") => client.readContract({ address: transistors, abi: transistorsAbi, functionName });
  const [price, fee, bem] = await Promise.all([read("mintPrice"), read("protocolFee"), client.readContract({ address: factory, abi: factoryAbi, functionName: "bem" })]);
  const cost = amount * price + fee;
  await allowBem({ client, wallet }, bem, transistors, cost);
  const receipt = await confirm(client, wallet.writeContract({ address: transistors, abi: transistorsAbi, functionName: "mint", args: [0n, amount], chain: wallet.chain }));
  return { hash: receipt.transactionHash, gasUsed: receipt.gasUsed, bemPaid: cost };
}

/** Burns one transistor per gate from the caller and mints the circuit NFT to it. */
export async function tapeout({ client, wallet }: TapeOutClients, circuits: Address, circuit: { netlist: Hex; nIn: number; nOut: number }) {
  const value = await client.readContract({ address: circuits, abi: circuitsAbi, functionName: "TAPEOUT_FEE" });
  const receipt = await confirm(
    client,
    wallet.writeContract({ address: circuits, abi: circuitsAbi, functionName: "tapeout", args: [circuit.netlist, circuit.nIn, circuit.nOut], value, chain: wallet.chain }),
  );
  const [taped] = parseEventLogs({ abi: circuitsAbi, eventName: "TapedOut", logs: receipt.logs });
  if (!taped) throw new Error("no TapedOut event");
  return { id: taped.args.circuitId, gateCount: taped.args.gateCount, hash: receipt.transactionHash, gasUsed: receipt.gasUsed, fee: value };
}

export const evalCircuit = (client: PublicClient, circuits: Address, id: bigint, inputs: Hex) =>
  client.readContract({ address: circuits, abi: circuitsAbi, functionName: "eval", args: [id, inputs] });

/** Opens the circuit's ERC-6551 container, which TapeSend needs before it sends as that container. Anyone may pay. */
export async function openContainer({ client, wallet }: TapeOutClients, opener: Address, circuits: Address, id: bigint) {
  const value = await client.readContract({ address: opener, abi: openerAbi, functionName: "FEE" });
  const receipt = await confirm(client, wallet.writeContract({ address: opener, abi: openerAbi, functionName: "open", args: [circuits, id], value, chain: wallet.chain }));
  const container = await client.readContract({ address: opener, abi: openerAbi, functionName: "accountOf", args: [circuits, id] });
  return { container, hash: receipt.transactionHash, gasUsed: receipt.gasUsed, fee: value };
}

/**
 * Sends one message as the container of (circuits, id). The caller must hold the circuit NFT and the container must be
 * open. The hub keeps only a digest; the payload (at most 16,000 bytes, not parsed) is in the `Sent` event.
 */
export async function sendMessage({ client, wallet }: TapeOutClients, hub: Address, m: { circuits: Address; id: bigint; to: Hex; payload: Hex; ref?: Hex }) {
  const receipt = await confirm(
    client,
    wallet.writeContract({ address: hub, abi: hubAbi, functionName: "send", args: [m.circuits, m.id, m.to, m.ref ?? ZERO32, m.payload], chain: wallet.chain }),
  );
  const [sent] = parseEventLogs({ abi: hubAbi, eventName: "Sent", logs: receipt.logs });
  if (!sent) throw new Error("no Sent event");
  return { inboxIndex: sent.args.inboxIndex, outboxIndex: sent.args.outboxIndex, from: sent.args.from, hash: receipt.transactionHash, gasUsed: receipt.gasUsed };
}
