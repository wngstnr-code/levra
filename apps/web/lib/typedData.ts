import type { Requirement, SignatureInput } from "@levra/shared/api";
import type { Hex, TypedDataDefinition } from "viem";

type Field = { name: string; type: string };
type Payload = { domain: Record<string, unknown>; types: Record<string, Field[]>; primaryType: string; message: Record<string, unknown> };

/** The service sends uint256 values as decimal strings so they survive JSON; wallets want bigints. */
export function toTypedData(raw: unknown): TypedDataDefinition {
  const p = raw as Payload;
  const fields = p.types[p.primaryType] ?? [];
  const message: Record<string, unknown> = { ...p.message };
  for (const f of fields) if (/^u?int\d*$/.test(f.type) && message[f.name] !== undefined) message[f.name] = BigInt(message[f.name] as string);
  const domain = { ...p.domain };
  if (typeof domain.chainId === "string") domain.chainId = Number(domain.chainId);
  return { domain, types: p.types, primaryType: p.primaryType, message } as unknown as TypedDataDefinition;
}

export function toSignatureInput(req: Requirement, signature: Hex): SignatureInput {
  const msg = (req.typedData as Payload).message;
  return { type: req.type, signature, deadline: Number(msg.deadline), ...(msg.nonce !== undefined ? { nonce: String(msg.nonce) } : {}) };
}

/** Requirements a free signature can cover, and those that need an approval transaction. */
export function splitRequirements(reqs: Requirement[], signed: SignatureInput[]) {
  const have = new Set(signed.map((s) => s.type));
  const open = reqs.filter((r) => !r.satisfied && !have.has(r.type));
  return { toSign: open.filter((r) => r.typedData !== undefined), toApprove: open.filter((r) => r.typedData === undefined && r.type === "approve") };
}
