/**
 * Unit tests for Naira on/off ramp via SEP-24 anchor (#514).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  isValidNuban,
  isValidBankCode,
  getBankByCode,
  getSep24StatusLabel,
  isSep24Terminal,
  isSep24Success,
  SUPPORTED_NIGERIAN_BANKS,
} from "./naira-ramp.ts"

describe("Naira Anchor Ramp - Bank Validation", () => {
  it("validates 10-digit NUBAN numbers", () => {
    assert.ok(isValidNuban("0123456789"))
    assert.ok(isValidNuban("2081234567"))
  })

  it("rejects non-10-digit or non-numeric account numbers", () => {
    assert.equal(isValidNuban("12345"), false)
    assert.equal(isValidNuban("12345678901"), false)
    assert.equal(isValidNuban("012345678a"), false)
    assert.equal(isValidNuban(""), false)
  })

  it("validates known Nigerian bank codes", () => {
    assert.ok(isValidBankCode("044")) // Access
    assert.ok(isValidBankCode("058")) // GTBank
    assert.ok(isValidBankCode("057")) // Zenith
    assert.ok(isValidBankCode("090267")) // Kuda
    assert.equal(isValidBankCode("999999"), false)
    assert.equal(isValidBankCode(""), false)
  })

  it("has a non-empty supported banks list", () => {
    assert.ok(SUPPORTED_NIGERIAN_BANKS.length >= 8)
  })

  it("looks a bank up by its code", () => {
    assert.equal(getBankByCode("058")?.name, "Guaranty Trust Bank (GTBank)")
    assert.equal(getBankByCode("999999"), undefined)
    assert.equal(getBankByCode(""), undefined)
  })
})

describe("Naira Anchor Ramp - SEP-24 Status Mapping", () => {
  it("correctly flags terminal and success states", () => {
    const completed = getSep24StatusLabel("completed")
    assert.equal(completed.isTerminal, true)
    assert.equal(completed.isSuccess, true)

    const error = getSep24StatusLabel("error")
    assert.equal(error.isTerminal, true)
    assert.equal(error.isSuccess, false)

    const expired = getSep24StatusLabel("expired")
    assert.equal(expired.isTerminal, true)
    assert.equal(expired.isSuccess, false)

    const pending = getSep24StatusLabel("pending_external")
    assert.equal(pending.isTerminal, false)
    assert.equal(pending.isSuccess, false)
  })

  it("reports terminal states the same way the label does", () => {
    assert.equal(isSep24Terminal("completed"), true)
    assert.equal(isSep24Terminal("expired"), true)
    assert.equal(isSep24Terminal("error"), true)
    assert.equal(isSep24Terminal("pending_anchor"), false)
    assert.equal(isSep24Terminal("incomplete"), false)
  })

  it("reports success only for a settled transaction", () => {
    assert.equal(isSep24Success("completed"), true)
    assert.equal(isSep24Success("expired"), false)
    assert.equal(isSep24Success("error"), false)
    assert.equal(isSep24Success("pending_anchor"), false)
  })
})
