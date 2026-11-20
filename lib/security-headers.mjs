/**
 * Response headers for every route. A wallet app should restrict which
 * scripts run and refuse to be framed, so a compromised third-party script or
 * a clickjacking page cannot reach the wallet.
 *
 * The Content-Security-Policy starts in report-only mode: violations are
 * reported in the browser console and nothing is blocked. Enforce it by setting
 * CSP_ENFORCE=true once the wallet connection, QR scanning and sending have
 * been checked with the policy in place.
 *
 * Plain ESM so next.config.mjs can import it; the test imports it from TS.
 */

/** Origins the app calls at runtime. Keep this list to what the code uses. */
export const CONNECT_SOURCES = [
  // Stellar Horizon, testnet and mainnet (lib/stellar.ts)
  "https://horizon-testnet.stellar.org",
  "https://horizon.stellar.org",
  // Base RPC, the default viem transport for base and baseSepolia (lib/wagmi.ts)
  "https://mainnet.base.org",
  "https://sepolia.base.org",
  // WalletConnect relay and registry, used by RainbowKit and the Stellar WalletConnect flow
  "https://*.walletconnect.org",
  "https://*.walletconnect.com",
  "wss://*.walletconnect.org",
  "wss://*.walletconnect.com",
  "https://*.reown.com",
  "wss://*.reown.com",
]

/**
 * @param {{ reportOnly?: boolean, dev?: boolean }} [options]
 * @returns {{ key: string, value: string }[]}
 */
export function buildSecurityHeaders({ reportOnly = true, dev = false } = {}) {
  const scriptSrc = ["'self'", "'unsafe-inline'"]
  // Next.js dev server uses eval for source maps and hot reload. Not in production.
  if (dev) scriptSrc.push("'unsafe-eval'")

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${CONNECT_SOURCES.join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")

  return [
    {
      key: reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
      value: csp,
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Camera is allowed for the same-origin QR scanner only. Everything else off.
    {
      key: "Permissions-Policy",
      value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ]
}
