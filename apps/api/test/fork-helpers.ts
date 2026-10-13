import { external } from "@levra/shared/addresses";
import { morphoAbi } from "@levra/shared/abis";
import type { Deployment } from "@levra/shared/deployments";
import { readDeployment } from "@levra/shared/deployments/node";
import {
  createTestClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  parseUnits,
  publicActions,
  toHex,
  walletActions,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { monad } from "viem/chains";

export const forkRpcUrl = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";
const forkDeploymentFile = process.env.FORK_DEPLOYMENT_FILE;
export const onFork = !!process.env.FORK_RPC_URL && !!forkDeploymentFile;

/** The fork deployment, or an empty one when the fork tests are skipped, so collecting them never touches the disk. */
export function forkDeployment(): Deployment {
  if (!onFork || !forkDeploymentFile) {
    return { chainId: 143, block: 0, router: zeroAddress, riskManager: zeroAddress, lens: zeroAddress, markets: [] };
  }
  return readDeployment(forkDeploymentFile);
}

export type ForkClient = ReturnType<typeof createForkClient>;

export function createForkClient(rpcUrl: string) {
  return createTestClient({ chain: monad, mode: "anvil", transport: http(rpcUrl) }).extend(publicActions).extend(walletActions);
}

export const randomAddress = () => privateKeyToAddress(generatePrivateKey());

export async function as<T>(chain: ForkClient, who: Address, run: () => Promise<T>): Promise<T> {
  await chain.impersonateAccount({ address: who });
  await chain.setBalance({ address: who, value: parseUnits("100", 18) });
  try {
    return await run();
  } finally {
    await chain.stopImpersonatingAccount({ address: who });
  }
}

export async function send(chain: ForkClient, from: Address, address: Address, abi: any, functionName: string, args: unknown[]) {
  const hash = await chain.writeContract({ account: from, chain: monad, address, abi, functionName, args } as any);
  const receipt = await chain.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return receipt;
}

/** Like forge's `deal`: finds the balance mapping slot by writing candidates and reading `balanceOf` back. */
export async function deal(chain: ForkClient, token: Address, to: Address, amount: bigint) {
  const value = toHex(amount, { size: 32 });
  for (let slot = 0n; slot < 64n; slot++) {
    for (const key of [
      keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [to, slot])),
      keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [slot, to])),
    ]) {
      const before = await chain.getStorageAt({ address: token, slot: key });
      await chain.setStorageAt({ address: token, index: key, value });
      const balance = await chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [to] });
      if (balance === amount) return;
      await chain.setStorageAt({ address: token, index: key, value: before ?? toHex(0n, { size: 32 }) });
    }
  }
  throw new Error(`No balance slot found for ${token}`);
}

/** Supplies loan tokens to a market from a fresh lender so there is something to borrow. */
export async function seedMarket(chain: ForkClient, marketId: Hex, amount: bigint) {
  const params = await chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "idToMarketParams", args: [marketId] });
  const lender = randomAddress();
  await deal(chain, params.loanToken, lender, amount);
  await as(chain, lender, async () => {
    await send(chain, lender, params.loanToken, erc20Abi, "approve", [external.morpho, amount]);
    await send(chain, lender, external.morpho, morphoAbi, "supply", [params, amount, 0n, lender, "0x"]);
  });
  return params;
}

/** Opens a position straight on Morpho for `user`, without the router. */
export async function openOnMorpho(chain: ForkClient, marketId: Hex, user: Address, collateral: bigint, borrow: bigint) {
  const params = await seedMarket(chain, marketId, borrow * 4n);
  await deal(chain, params.collateralToken, user, collateral);
  await as(chain, user, async () => {
    await send(chain, user, params.collateralToken, erc20Abi, "approve", [external.morpho, collateral]);
    await send(chain, user, external.morpho, morphoAbi, "supplyCollateral", [params, collateral, user, "0x"]);
    await send(chain, user, external.morpho, morphoAbi, "borrow", [params, borrow, 0n, user, user]);
  });
}
