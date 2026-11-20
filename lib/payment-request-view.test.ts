import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildRequestUri, formatRequestAmount, resolveRequestView } from "./payment-request-view.ts"

describe("payment request view helpers", () => {
  const now = Date.parse("2026-01-01T00:00:00Z")
  it("renders open, partial, paid and expired states", () => {
    const future = "2026-02-01T00:00:00Z"
    assert.equal(resolveRequestView("pending", future, now), "open")
    assert.equal(resolveRequestView("partially_paid", future, now), "partially_paid")
    assert.equal(resolveRequestView("paid", future, now), "paid")
    assert.equal(resolveRequestView("expired", future, now), "expired")
    assert.equal(resolveRequestView("pending", "2025-12-01T00:00:00Z", now), "expired")
    assert.equal(resolveRequestView("cancelled", future, now), "cancelled")
  })
  it("formats minor units without floats", () => {
    assert.equal(formatRequestAmount("15000000", "USDC"), "1.5")
    assert.equal(formatRequestAmount("not-a-number", "USDC"), "not-a-number")
  })
  it("builds the request URI", () => {
    assert.equal(buildRequestUri("abc", "USDC", "100"), "engipay:abc?asset=USDC&amount=100")
  })
})

describe("cancelled requests", () => {
  it("cannot be shown as open", () => {
    assert.equal(resolveRequestView("cancelled", "2099-01-01T00:00:00Z"), "cancelled")
  })
})
