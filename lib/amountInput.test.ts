/**
 * Tests for the amount parsing helpers behind AmountInput.
 *
 * Run with: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { decimalsForAsset, isPositiveAmount, sanitizeAmount } from "./amountInput.ts"

describe("sanitizeAmount", () => {
  it("keeps digits and one separator", () => {
    assert.equal(sanitizeAmount("12.5", 8), "12.5")
    assert.equal(sanitizeAmount("1,5", 8), "1.5")
    assert.equal(sanitizeAmount("1.2.3", 8), "1.23")
    assert.equal(sanitizeAmount("abc-1e5", 8), "15")
  })

  it("blocks a ninth decimal for BTC", () => {
    assert.equal(sanitizeAmount("0.123456789", decimalsForAsset("BTC")), "0.12345678")
  })

  it("blocks a seventh decimal for USDC", () => {
    assert.equal(sanitizeAmount("1.1234567", decimalsForAsset("USDC")), "1.123456")
  })

  it("drops the separator when no decimals are allowed", () => {
    assert.equal(sanitizeAmount("10.5", 0), "10")
  })
})

describe("isPositiveAmount", () => {
  it("accepts amounts above zero", () => {
    assert.equal(isPositiveAmount("0.01"), true)
    assert.equal(isPositiveAmount("5."), true)
  })

  it("refuses zero, empty and a bare separator", () => {
    assert.equal(isPositiveAmount("0"), false)
    assert.equal(isPositiveAmount("0.00"), false)
    assert.equal(isPositiveAmount(""), false)
    assert.equal(isPositiveAmount("."), false)
  })
})
