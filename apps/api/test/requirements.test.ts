import { describe, expect, it } from "vitest";
import type { ChainReader, UserState } from "../src/chain/reader";
import { checkRequirements } from "../src/quotes/requirements";

const user = "0x1111111111111111111111111111111111111111";
const router = "0x2222222222222222222222222222222222222222";
const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const stock = "0x1446501E886c7f830DB9b494A1890cBCCC072f57";

function fakeReader(asked: { permit: boolean }[]): ChainReader {
  return {
    deployment: { router, chainId: 143, markets: [{ loanToken: usdc }] },
    userState: async (_user: string, _token: string, opts: { permit: boolean }): Promise<UserState> => {
      asked.push(opts);
      return { balance: 10n ** 24n, allowance: 0n, permitNonce: opts.permit ? 7n : null, authorized: true, morphoNonce: 0n };
    },
    permitDomain: async () => ({ name: "USD Coin", version: "2" }),
  } as unknown as ChainReader;
}

describe("token approval requirements", () => {
  it("asks for a plain approve on a stock token and never reads its permit nonce", async () => {
    const asked: { permit: boolean }[] = [];
    const check = await checkRequirements(fakeReader(asked), { user, pull: { token: stock, amount: 5n, permit: false }, authorization: false, blockTime: 1_000 });
    expect(asked).toEqual([{ permit: false }]);
    expect(check.ready).toBe(false);
    expect(check.requirements[0]).toMatchObject({ type: "approve", satisfied: false, token: stock });
    expect(check.requirements[0]).not.toHaveProperty("typedData");
  });

  it("offers a permit with the current nonce for USDC", async () => {
    const asked: { permit: boolean }[] = [];
    const check = await checkRequirements(fakeReader(asked), { user, pull: { token: usdc, amount: 5n, permit: true }, authorization: false, blockTime: 1_000 });
    expect(asked).toEqual([{ permit: true }]);
    const approve = check.requirements[0] as { typedData: { message: { nonce: string | bigint } } };
    expect(BigInt(approve.typedData.message.nonce)).toBe(7n);
  });
});
