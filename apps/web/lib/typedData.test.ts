import type { Requirement } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { splitRequirements, toSignatureInput, toTypedData } from "./typedData";

const authorization: Requirement = {
  type: "morphoAuthorization",
  satisfied: false,
  spender: "0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6",
  typedData: {
    domain: { chainId: 143, verifyingContract: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee" },
    types: { Authorization: [{ name: "authorizer", type: "address" }, { name: "isAuthorized", type: "bool" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Authorization",
    message: { authorizer: "0xCFb0bE5E3218606fB541855f45711c981Ea9d0A5", isAuthorized: true, nonce: "3", deadline: "1791883600" },
  },
};
const approveTx: Requirement = { type: "approve", satisfied: false, token: "0x1446501E886c7f830DB9b494A1890cBCCC072f57", amountRaw: "1" };

describe("typed data from the service", () => {
  it("turns uint strings into bigints and keeps the rest", () => {
    const td = toTypedData(authorization.typedData);
    expect(td.message).toEqual({ authorizer: "0xCFb0bE5E3218606fB541855f45711c981Ea9d0A5", isAuthorized: true, nonce: 3n, deadline: 1791883600n });
  });

  it("builds the signature input the next quote needs", () => {
    expect(toSignatureInput(authorization, "0xabcd")).toEqual({ type: "morphoAuthorization", signature: "0xabcd", deadline: 1791883600, nonce: "3" });
  });

  it("splits what can be signed from what needs a transaction", () => {
    expect(splitRequirements([authorization, approveTx], [])).toEqual({ toSign: [authorization], toApprove: [approveTx] });
    expect(splitRequirements([authorization], [{ type: "morphoAuthorization", signature: "0x01", deadline: 1 }]).toSign).toEqual([]);
  });
});
