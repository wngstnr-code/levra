import { createPublicClient, encodeFunctionData, http, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { BASE_CHAIN_ID, externalByChain } from "./addresses";
import { baseStocks } from "./markets";

// B20 stock tokens are Base precompiles, so a local fork cannot run them (anvil answers OpcodeNotFound).
// These checks run against a live Base node instead: reads, plus eth_simulateV1, which executes calls
// from any address without a signature and changes nothing on chain. Set BASE_RPC_URL to run them.
const rpcUrl = process.env.BASE_RPC_URL;
const base = externalByChain[BASE_CHAIN_ID];

const b20Abi = parseAbi([
  "function policyId(bytes32 policyScope) view returns (uint64)",
  "function isPaused(uint8 feature) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
]);
const policyRegistryAbi = parseAbi([
  "function policyExists(uint64 policyId) view returns (bool)",
  "function isAuthorized(uint64 policyId, address account) view returns (bool)",
]);

const scopes = ["TRANSFER_SENDER_POLICY", "TRANSFER_RECEIVER_POLICY", "TRANSFER_EXECUTOR_POLICY"].map((name) => keccak256(toBytes(name)));
const pausableFeatures = { transfer: 0, mint: 1, burn: 2, seize: 3 } as const;

/** Stands for our router, liquidator and a user wallet, which do not exist on Base yet. */
const freshAccount: Address = "0x00000000000000000000000000000000004c3e5a";

const swapRouters = { oneInch: base.oneInchRouter, aerodrome: base.aerodromeRouter, aerodromeSlipstream: base.aerodromeSlipstreamRouter };
const accountsThatMustPass = { morpho: base.morpho, ...swapRouters, fresh: freshAccount };

type Call = { from: Address; to: Address; data: Hex };
type SimulatedCall = { status: Hex; returnData: Hex; error?: { message: string } };

describe.skipIf(!rpcUrl)("Coinbase stock tokens on Base, live", () => {
  const client = createPublicClient({ transport: http(rpcUrl) });

  async function simulate(calls: Call[]): Promise<SimulatedCall[]> {
    const result = await client.request<{
      Method: "eth_simulateV1";
      Parameters: [unknown, "latest"];
      ReturnType: { calls: SimulatedCall[] }[];
    }>({ method: "eth_simulateV1", params: [{ blockStateCalls: [{ calls }], validation: false }, "latest"] });
    const [block] = result;
    if (!block) throw new Error("eth_simulateV1 returned no block");
    return block.calls;
  }

  const call = (from: Address, to: Address, functionName: "approve" | "transfer", args: readonly [Address, bigint]): Call => ({
    from,
    to,
    data: encodeFunctionData({ abi: b20Abi, functionName, args }),
  });
  const pull = (executor: Address, token: Address, from: Address, to: Address): Call => ({
    from: executor,
    to: token,
    data: encodeFunctionData({ abi: b20Abi, functionName: "transferFrom", args: [from, to, 1n] }),
  });

  for (const stock of Object.values(baseStocks)) {
    describe(stock.tokenSymbol, () => {
      it("uses one existing transfer policy that authorizes Morpho, the swap routers and a fresh address", async () => {
        const ids = await Promise.all(scopes.map((scope) => client.readContract({ address: stock.token, abi: b20Abi, functionName: "policyId", args: [scope] })));
        for (const id of new Set(ids)) {
          expect(await client.readContract({ address: base.b20PolicyRegistry, abi: policyRegistryAbi, functionName: "policyExists", args: [id] })).toBe(true);
          for (const [name, account] of Object.entries(accountsThatMustPass)) {
            const ok = await client.readContract({ address: base.b20PolicyRegistry, abi: policyRegistryAbi, functionName: "isAuthorized", args: [id, account] });
            expect(ok, `${name} under policy ${id}`).toBe(true);
          }
        }
      });

      it("has no paused feature", async () => {
        for (const [name, feature] of Object.entries(pausableFeatures)) {
          expect(await client.readContract({ address: stock.token, abi: b20Abi, functionName: "isPaused", args: [feature] }), name).toBe(false);
        }
      });

      it("moves out of Morpho, back in through transferFrom, and through every swap router", async () => {
        expect(await client.readContract({ address: stock.token, abi: b20Abi, functionName: "balanceOf", args: [base.morpho] })).toBeGreaterThan(0n);
        const routerLegs = Object.values(swapRouters).flatMap((router) => [
          call(freshAccount, stock.token, "approve", [router, 1n]),
          pull(router, stock.token, freshAccount, router),
          call(router, stock.token, "transfer", [freshAccount, 1n]),
        ]);
        const calls = [
          call(base.morpho, stock.token, "transfer", [freshAccount, 1n]),
          ...routerLegs,
          call(freshAccount, stock.token, "approve", [base.morpho, 1n]),
          pull(base.morpho, stock.token, freshAccount, base.morpho),
        ];
        const results = await simulate(calls);
        results.forEach((r, i) => expect(r.status, `call ${i}: ${r.error?.message ?? ""}`).toBe("0x1"));
      });

      it("refuses a pull without approval, so the simulation enforces the token rules", async () => {
        const [send, unapproved] = await simulate([
          call(base.morpho, stock.token, "transfer", [freshAccount, 1n]),
          pull(base.oneInchRouter, stock.token, freshAccount, base.oneInchRouter),
        ]);
        expect(send?.status).toBe("0x1");
        expect(unapproved?.status).toBe("0x0");
      });
    });
  }
});
