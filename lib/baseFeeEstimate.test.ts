import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { estimateFeeWei, feeWarning, maxNativeSendable } from "./baseFeeEstimate.ts"

describe("Base fee helpers", () => {
  it("multiplies gas by the max fee per gas", () => {
    assert.equal(estimateFeeWei(21_000n, 2_000_000_000n), 42_000_000_000_000n)
  })

  it("leaves room for the fee on a max ETH send, never negative", () => {
    assert.equal(maxNativeSendable(1_000_000n, 40_000n), 960_000n)
    assert.equal(maxNativeSendable(10_000n, 40_000n), 0n)
  })

  it("warns when ETH cannot cover the fee, including for token sends", () => {
    const base = { ethBalanceWei: 100n, feeWei: 40n }
    assert.equal(feeWarning({ ...base, isNative: true, amountWei: 70n }), "native-short")
    assert.equal(feeWarning({ ...base, isNative: true, amountWei: 60n }), null)
    assert.equal(feeWarning({ ...base, isNative: false, amountWei: 1_000_000n }), null)
    assert.equal(feeWarning({ ethBalanceWei: 10n, feeWei: 40n, isNative: false, amountWei: 1n }), "token-needs-eth")
  })
})
