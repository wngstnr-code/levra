/**
 * Base Builder Codes (BE-74): an ERC-8021 suffix at the end of a transaction's calldata tells Base which app sent it.
 * Contracts ignore the extra bytes, since ABI decoding never reads past the arguments. Schema 0, as `ox/erc8021` writes
 * it: the codes in ASCII, joined by commas, then their length (1 byte), the schema id 0 (1 byte) and the 16 byte marker.
 */
export const ERC8021_MARKER = "80218021802180218021802180218021";

/** Levra's code per chain, registered at base.dev. Only Base counts Builder Codes. */
export const builderCodes: Partial<Record<number, string>> = {};

const CODE = /^[\x21-\x2b\x2d-\x7e]+$/;

export function builderCodeSuffix(codes: readonly string[]): `0x${string}` {
  if (codes.length === 0 || !codes.every((c) => CODE.test(c))) throw new Error("Builder codes must be printable ASCII without commas or spaces");
  const joined = codes.join(",");
  if (joined.length > 255) throw new Error("Builder codes are longer than 255 bytes");
  const ascii = [...joined].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return `0x${ascii}${joined.length.toString(16).padStart(2, "0")}00${ERC8021_MARKER}`;
}

/** Calldata with the chain's Builder Code appended, or unchanged where the chain has none. */
export function withBuilderCode<T extends `0x${string}`>(chainId: number, data: T, codes = builderCodes): T {
  const code = codes[chainId];
  return code ? (`${data}${builderCodeSuffix([code]).slice(2)}` as T) : data;
}
