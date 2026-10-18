import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { formatNaira, formatRate, isQuoteLive, secondsLeft, type BuyQuote } from "./buy.ts"

const expiresAt = "2026-10-18T20:02:00Z"
const expiresMs = Date.parse(expiresAt)

describe("formatNaira", () => {
  it("shows kobo as Naira with two decimals and thousands separators", () => {
    assert.equal(formatNaira("5000"), "₦50.00")
    assert.equal(formatNaira("500000"), "₦5,000.00")
    assert.equal(formatNaira("500050"), "₦5,000.50")
  })
})

describe("formatRate", () => {
  it("names the rate per asset", () => {
    const quote = { asset: "USDC", kobo_per_unit: "150000" } as BuyQuote
    assert.equal(formatRate(quote), "₦1,500.00 per USDC")
  })
})

describe("quote expiry", () => {
  it("counts whole seconds down to zero", () => {
    assert.equal(secondsLeft(expiresAt, expiresMs - 90_000), 90)
    assert.equal(secondsLeft(expiresAt, expiresMs), 0)
    assert.equal(secondsLeft(expiresAt, expiresMs + 5_000), 0)
  })

  it("is live right up to the expiry instant and not after", () => {
    assert.equal(isQuoteLive(expiresAt, expiresMs - 1_000), true)
    assert.equal(isQuoteLive(expiresAt, expiresMs), false)
  })

  it("treats an unreadable expiry as lapsed rather than live", () => {
    assert.equal(isQuoteLive("not a date", expiresMs), false)
  })
})
