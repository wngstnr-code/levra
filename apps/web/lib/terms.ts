/**
 * The exact text a user signs to accept the terms (FE-50). The service rebuilds the same text from
 * the version and address to check the signature, so it is part of the interface in 03.
 */
export function termsMessage(termsVersion: string, address: string): string {
  return [
    "Levra terms of use",
    `Version: ${termsVersion}`,
    `Address: ${address}`,
    "I confirm that I am not a resident of, or located in, a restricted region, that I read the risk disclosure, and that I accept the terms of use.",
  ].join("\n");
}
