/**
 * The message a wallet signs to sign in. The API finds the nonce on its own
 * `Nonce:` line (see backend routes/auth/siwe.rs), so keep that line intact.
 */
export function buildSignInMessage(input: { address: string; nonce: string; issuedAt: Date }): string {
  return [
    "Sign in to EngiPay",
    "",
    `Address: ${input.address}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
  ].join("\n")
}
