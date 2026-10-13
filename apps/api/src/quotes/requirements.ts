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

/** Checks the token approval and the Morpho authorization the router needs, for an action that pulls `amount` of `token`. */
export async function checkRequirements(
  reader: ChainReader,
  p: { user: Address; token: Address; amount: bigint; signatures?: SignatureInput[]; blockTime: number },
): Promise<RequirementCheck> {
  const { router, chainId } = reader.deployment;
  const state = await reader.userState(p.user, p.token);
  const deadline = p.blockTime + SIGNATURE_VALIDITY;
  const signed = new Map((p.signatures ?? []).map((s) => [s.type, s]));
  const preCalls: Hex[] = [];

  const approveMet = state.allowance >= p.amount;
  const approveSig = approveMet ? undefined : signed.get("approve");
  if (approveSig) {
    const { r, s, v, yParity } = parseSignature(approveSig.signature);
    preCalls.push(
      encodeFunctionData({
        abi: marginRouterAbi,
        functionName: "permitToken",
        args: [p.token, p.amount, BigInt(approveSig.deadline), Number(v ?? BigInt(yParity + 27)), r, s],
      }),
    );
  }

  const authMet = state.authorized;
  const authSig = authMet ? undefined : signed.get("morphoAuthorization");
  if (authSig) {
    const { r, s, v, yParity } = parseSignature(authSig.signature);
    const nonce = authSig.nonce === undefined ? state.morphoNonce : BigInt(authSig.nonce);
    preCalls.push(
      encodeFunctionData({
        abi: marginRouterAbi,
        functionName: "authorizeWithSig",
        args: [p.user, true, nonce, BigInt(authSig.deadline), Number(v ?? BigInt(yParity + 27)), r, s],
      }),
    );
  }

  const requirements: Requirement[] = [
    {
      type: "approve",
      satisfied: approveMet,
      token: p.token,
      spender: router,
      amountRaw: p.amount.toString(),
      ...(approveMet
        ? {}
        : {
            typedData: permitTypedData({
              token: p.token,
              ...(await reader.permitDomain(p.token)),
              chainId,
              owner: p.user,
              spender: router,
              value: p.amount,
              nonce: state.permitNonce,
              deadline,
            }),
          }),
    },
    {
      type: "morphoAuthorization",
      satisfied: authMet,
      spender: router,
      ...(authMet
        ? {}
        : { typedData: authorizationTypedData({ chainId, authorizer: p.user, authorized: router, nonce: state.morphoNonce, deadline }) }),
    },
  ];

  if (signed.size > 0 && preCalls.length === 0 && (!approveMet || !authMet)) {
    throw new ApiHttpError("BAD_REQUEST", "The signatures sent do not match the missing requirements.");
  }

  return {
    requirements,
    preCalls,
    ready: (approveMet || !!approveSig) && (authMet || !!authSig),
    funded: state.balance >= p.amount,
  };
}
