import { external } from "@levra/shared/addresses";
import { marginRouterAbi } from "@levra/shared/abis";
import type { Requirement, SignatureInput } from "@levra/shared/api";
import { encodeFunctionData, parseSignature, type Address, type Hex } from "viem";
import type { ChainReader } from "../chain/reader";
import { ApiHttpError } from "../errors";

/** Signatures asked for in a quote stay valid this long, in seconds. */
const SIGNATURE_VALIDITY = 3_600;

/** uint256 values in typed data are decimal strings, so the payload survives JSON. */
function permitTypedData(p: { token: Address; name: string; version: string; chainId: number; owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: number }) {
  return {
    domain: { name: p.name, version: p.version, chainId: p.chainId, verifyingContract: p.token },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: p.owner, spender: p.spender, value: p.value.toString(), nonce: p.nonce.toString(), deadline: p.deadline.toString() },
  };
}

/** Morpho Blue signs authorizations with a domain of chainId and verifyingContract only. */
function authorizationTypedData(p: { chainId: number; authorizer: Address; authorized: Address; nonce: bigint; deadline: number }) {
  return {
    domain: { chainId: p.chainId, verifyingContract: external.morpho },
    types: {
      Authorization: [
        { name: "authorizer", type: "address" },
        { name: "authorized", type: "address" },
        { name: "isAuthorized", type: "bool" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Authorization",
    message: { authorizer: p.authorizer, authorized: p.authorized, isAuthorized: true, nonce: p.nonce.toString(), deadline: p.deadline.toString() },
  };
}

export type RequirementCheck = {
  requirements: Requirement[];
  /** Calls to run before the action inside one multicall, built from the signatures sent with the request. */
  preCalls: Hex[];
  /** True when every requirement is met on chain or covered by a signature. */
  ready: boolean;
  /** True when the user holds at least the amount the action pulls. */
  funded: boolean;
};

export type RequirementInput = {
  user: Address;
  /** The token the router pulls from the user, if any. `permit` says whether a signature can replace `approve`. */
  pull?: { token: Address; amount: bigint; permit: boolean };
  /** Whether the router acts on the user's Morpho position (borrow, repay, withdraw). */
  authorization: boolean;
  signatures?: SignatureInput[];
  blockTime: number;
};

function vOf(signature: Hex) {
  const { r, s, v, yParity } = parseSignature(signature);
  return { r, s, v: Number(v ?? BigInt(yParity + 27)) };
}

/** Checks the token approval and the Morpho authorization the router needs for one action. */
export async function checkRequirements(reader: ChainReader, p: RequirementInput): Promise<RequirementCheck> {
  const { router, chainId } = reader.deployment;
  const state = await reader.userState(p.user, p.pull?.token ?? reader.deployment.markets[0]!.loanToken, { permit: p.pull?.permit ?? false });
  const deadline = p.blockTime + SIGNATURE_VALIDITY;
  const signed = new Map((p.signatures ?? []).map((s) => [s.type, s]));
  const preCalls: Hex[] = [];
  const requirements: Requirement[] = [];
  let ready = true;

  if (p.pull) {
    const met = state.allowance >= p.pull.amount;
    const nonce = state.permitNonce;
    const sig = met || nonce === null ? undefined : signed.get("approve");
    if (sig) {
      const { r, s, v } = vOf(sig.signature);
      preCalls.push(encodeFunctionData({ abi: marginRouterAbi, functionName: "permitToken", args: [p.pull.token, p.pull.amount, BigInt(sig.deadline), v, r, s] }));
    }
    ready &&= met || !!sig;
    requirements.push({
      type: "approve",
      satisfied: met,
      token: p.pull.token,
      spender: router,
      amountRaw: p.pull.amount.toString(),
      ...(met || nonce === null
        ? {}
        : {
            typedData: permitTypedData({
              token: p.pull.token,
              ...(await reader.permitDomain(p.pull.token)),
              chainId,
              owner: p.user,
              spender: router,
              value: p.pull.amount,
              nonce,
              deadline,
            }),
          }),
    });
  }

  if (p.authorization) {
    const met = state.authorized;
    const sig = met ? undefined : signed.get("morphoAuthorization");
    if (sig) {
      const { r, s, v } = vOf(sig.signature);
      const nonce = sig.nonce === undefined ? state.morphoNonce : BigInt(sig.nonce);
      preCalls.push(encodeFunctionData({ abi: marginRouterAbi, functionName: "authorizeWithSig", args: [p.user, true, nonce, BigInt(sig.deadline), v, r, s] }));
    }
    ready &&= met || !!sig;
    requirements.push({
      type: "morphoAuthorization",
      satisfied: met,
      spender: router,
      ...(met ? {} : { typedData: authorizationTypedData({ chainId, authorizer: p.user, authorized: router, nonce: state.morphoNonce, deadline }) }),
    });
  }

  if (signed.size > 0 && preCalls.length === 0 && !ready) {
    throw new ApiHttpError("BAD_REQUEST", "The signatures sent do not match the missing requirements.");
  }

  return { requirements, preCalls, ready, funded: !p.pull || state.balance >= p.pull.amount };
}
