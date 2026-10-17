/**
 * Tests for the response headers. These decide what the browser may run and
 * whether the app can be framed, so the policy is pinned here.
 *
 * Run with: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildSecurityHeaders, CONNECT_SOURCES } from "./security-headers.mjs"

function header(headers: { key: string; value: string }[], key: string): string | undefined {
  return headers.find((h) => h.key === key)?.value
}

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `) || part === name)
}

describe("security headers", () => {
  it("starts the CSP in report-only mode by default", () => {
    const headers = buildSecurityHeaders()
    assert.ok(header(headers, "Content-Security-Policy-Report-Only"))
    assert.equal(header(headers, "Content-Security-Policy"), undefined)
  })

  it("enforces the CSP only when reportOnly is false", () => {
    const headers = buildSecurityHeaders({ reportOnly: false })
    assert.ok(header(headers, "Content-Security-Policy"))
    assert.equal(header(headers, "Content-Security-Policy-Report-Only"), undefined)
  })

  it("refuses to be framed, by CSP and by the older header", () => {
    const headers = buildSecurityHeaders({ reportOnly: false })
    assert.equal(directive(header(headers, "Content-Security-Policy")!, "frame-ancestors"), "frame-ancestors 'none'")
    assert.equal(header(headers, "X-Frame-Options"), "DENY")
  })

  it("keeps eval out of production scripts and allows it only in dev", () => {
    const prod = header(buildSecurityHeaders(), "Content-Security-Policy-Report-Only")!
    assert.ok(!directive(prod, "script-src")!.includes("'unsafe-eval'"))
    const dev = header(buildSecurityHeaders({ dev: true }), "Content-Security-Policy-Report-Only")!
    assert.ok(directive(dev, "script-src")!.includes("'unsafe-eval'"))
  })

  it("allows connections only to the Horizon, Base RPC and WalletConnect origins", () => {
    const csp = header(buildSecurityHeaders(), "Content-Security-Policy-Report-Only")!
    const connect = directive(csp, "connect-src")!
    for (const origin of CONNECT_SOURCES) {
      assert.ok(connect.includes(origin), `missing ${origin}`)
    }
    assert.ok(connect.includes("https://horizon.stellar.org"))
    assert.ok(connect.includes("https://mainnet.base.org"))
    assert.ok(connect.includes("wss://*.walletconnect.org"))
    assert.ok(!connect.includes("https://*.example.com"))
  })

  it("allows the camera for the same origin only, and turns off other sensors", () => {
    const policy = header(buildSecurityHeaders(), "Permissions-Policy")!
    assert.ok(policy.includes("camera=(self)"))
    assert.ok(policy.includes("microphone=()"))
    assert.ok(policy.includes("geolocation=()"))
  })

  it("sends the no-sniff and referrer headers on every response", () => {
    const headers = buildSecurityHeaders()
    assert.equal(header(headers, "X-Content-Type-Options"), "nosniff")
    assert.equal(header(headers, "Referrer-Policy"), "strict-origin-when-cross-origin")
  })
})
