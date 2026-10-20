import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { validateSendAmount } from "./amountValidation.ts"

describe("validateSendAmount", () => {
  it("converts a valid amount to base units", () => {
    assert.deepEqual(validateSendAmount("1.5", 6, "USDC", 2_000_000n), { ok: true, units: 1_500_000n })
    assert.deepEqual(validateSendAmount(".5", 18, "ETH"), { ok: true, units: 500_000_000_000_000_000n })
  })

  it("refuses more decimals than the token has", () => {
    const result = validateSendAmount("0.1234567", 6, "USDC", 10_000_000n)
    assert.equal(result.ok, false)
    assert.match(!result.ok ? result.message : "", /6 decimal places/)
  })

  it("refuses zero, empty and malformed input", () => {
    for (const value of ["", ".", "0", "0.000", "-1", "1e5", "1,5", "abc"]) {
      assert.equal(validateSendAmount(value, 6, "USDC").ok, false, value)
    }
  })

  it("refuses an amount above the balance, exactly at the boundary", () => {
    assert.equal(validateSendAmount("1.000001", 6, "USDC", 1_000_000n).ok, false)
    assert.equal(validateSendAmount("1", 6, "USDC", 1_000_000n).ok, true)
  })
})
