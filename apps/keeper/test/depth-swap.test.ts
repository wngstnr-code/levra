import type { SwapProvider } from "@levra/swap";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { depthSwap } from "../src/dex/swap";

const noClient = {} as PublicClient;
const keys = { kyberClientId: "levra" };
const okx = { apiKey: "k", secretKey: "s", passphrase: "p" };

describe("the depth job's swap source per chain (BE-96, BE-81)", () => {
  it("measures X Layer on Uniswap alone without the OKX keys", () => {
    expect((depthSwap(196, noClient, keys) as SwapProvider).name).toBe("uniswap");
  });

  it("measures X Layer on the better of OKX and Uniswap with the OKX keys", () => {
    const source = depthSwap(196, noClient, { ...keys, okx });
    // bestRoute is a plain source, not one named provider.
    expect((source as Partial<SwapProvider>).name).toBeUndefined();
    expect(typeof source.price).toBe("function");
  });

  it("keeps KyberSwap on Monad", () => {
    expect((depthSwap(143, noClient, keys) as SwapProvider).name).toBe("kyberswap");
  });
});
