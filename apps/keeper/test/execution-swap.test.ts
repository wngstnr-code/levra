import { externalByChain } from "@levra/shared/addresses";
import type { Address, PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { executionSwap, keeperProviders } from "../src/dex/swap";

const CONTRACT = "0x00000000000000000000000000000000000000aa" as Address;
const keys = { kyberClientId: "levra" };
const okxKeys = { ...keys, okx: { apiKey: "k", secretKey: "s", passphrase: "p" } };

/** A contract that accepts `targets` (each approving itself as spender) and nothing else. */
function contractClient(targets: Address[]) {
  return {
    async readContract({ functionName, args }: { functionName: string; args?: readonly unknown[] }) {
      if (functionName === "swapTargets") return targets;
      if (functionName === "swapSpender") return args![0];
      throw new Error(`unexpected ${functionName}`);
    },
  } as unknown as PublicClient;
}

describe("keeper swap routes on Base and X Layer (BE-73, BE-80)", () => {
  it("leaves 1inch out on Base and adds OKX on X Layer only with its keys", () => {
    expect(keeperProviders(8453, {} as PublicClient, keys).map((p) => p.name)).toEqual(["kyberswap", "aero"]);
    expect(keeperProviders(196, {} as PublicClient, keys).map((p) => p.name)).toEqual(["uniswap"]);
    expect(keeperProviders(196, {} as PublicClient, okxKeys).map((p) => p.name)).toEqual(["okx", "uniswap"]);
  });

  it("refuses to quote when the contract accepts none of the keeper's providers", async () => {
    const client = contractClient([externalByChain[8453].oneInchRouter]);
    const swap = executionSwap(client, CONTRACT, keeperProviders(8453, client, keys));
    const params = { tokenIn: CONTRACT, tokenOut: CONTRACT, amountIn: 1n, sender: CONTRACT, slippageBps: 100 };
    await expect(swap.quote(params)).rejects.toMatchObject({ code: "NO_ROUTE" });
  });
});
