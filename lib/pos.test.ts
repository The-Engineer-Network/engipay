import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  toMinorUnits,
  fromMinorUnits,
  addDecimals,
  subtractDecimals,
  compareDecimals,
  calculatePosStatus,
  calculateProgress,
  formatCountdown,
  buildPosPaymentUri,
  getAssetDecimals,
} from "./pos.ts"

describe("POS decimal precision and arithmetic", () => {
  it("converts decimal strings to minor units without floating-point inaccuracies", () => {
    assert.equal(toMinorUnits("12.345678", 6), 12345678n)
    assert.equal(toMinorUnits("0.000001", 6), 1n)
    assert.equal(toMinorUnits("100", 6), 100000000n)
    assert.equal(toMinorUnits("0", 6), 0n)
    assert.equal(toMinorUnits("0.5", 7), 5000000n)
    assert.equal(toMinorUnits("1.000000000000000001", 18), 1000000000000000001n)
  })

  it("converts minor units back to human-readable decimal strings", () => {
    assert.equal(fromMinorUnits(12345678n, 6), "12.345678")
    assert.equal(fromMinorUnits(1n, 6), "0.000001")
    assert.equal(fromMinorUnits(100000000n, 6), "100")
    assert.equal(fromMinorUnits(0n, 6), "0")
    assert.equal(fromMinorUnits(5000000n, 7), "0.5")
  })

  it("adds decimal amounts with exact precision", () => {
    assert.equal(addDecimals("12.34", "5.66", 6), "18")
    assert.equal(addDecimals("0.1", "0.2", 6), "0.3") // IEEE-754 0.1+0.2=0.30000000000000004 avoided
    assert.equal(addDecimals("1.2500000", "0.7500000", 7), "2")
  })

  it("subtracts decimal amounts and floors at zero when negative not allowed", () => {
    assert.equal(subtractDecimals("10.00", "4.25", 6), "5.75")
    assert.equal(subtractDecimals("5.00", "5.00", 6), "0")
    assert.equal(subtractDecimals("3.00", "5.00", 6), "0")
    assert.equal(subtractDecimals("3.00", "5.00", 6, true), "-2")
  })

  it("compares decimal values correctly", () => {
    assert.equal(compareDecimals("10.50", "10.50", 6), 0)
    assert.equal(compareDecimals("10.51", "10.50", 6), 1)
    assert.equal(compareDecimals("9.99", "10.00", 6), -1)
  })

  it("identifies standard decimals per asset and chain", () => {
    assert.equal(getAssetDecimals("USDC", "stellar"), 7)
    assert.equal(getAssetDecimals("XLM", "stellar"), 7)
    assert.equal(getAssetDecimals("USDC", "base"), 6)
    assert.equal(getAssetDecimals("ETH", "base"), 18)
    assert.equal(getAssetDecimals("BTC", "bitcoin"), 8)
  })
})

describe("POS invoice status and lifecycle", () => {
  const now = 1700000000000
  const future = now + 600000 // +10 minutes
  const past = now - 1000 // -1 second

  it("reports 'open' when unpaid and within expiry window", () => {
    const status = calculatePosStatus("50.00", "0", future, now, 6)
    assert.equal(status, "open")
  })

  it("reports 'partially_paid' when some payment is received before expiry", () => {
    const status = calculatePosStatus("50.00", "20.00", future, now, 6)
    assert.equal(status, "partially_paid")
  })

  it("reports 'paid' when exact amount is received", () => {
    const status = calculatePosStatus("50.00", "50.00", future, now, 6)
    assert.equal(status, "paid")
  })

  it("reports 'paid' when overpaid", () => {
    const status = calculatePosStatus("50.00", "55.00", future, now, 6)
    assert.equal(status, "paid")
  })

  it("reports 'paid' even if settled past the initial expiry cutoff", () => {
    const status = calculatePosStatus("50.00", "50.00", past, now, 6)
    assert.equal(status, "paid")
  })

  it("reports 'expired' when unpaid or partially paid past expiry", () => {
    const statusUnpaid = calculatePosStatus("50.00", "0", past, now, 6)
    assert.equal(statusUnpaid, "expired")

    const statusPartial = calculatePosStatus("50.00", "25.00", past, now, 6)
    assert.equal(statusPartial, "expired")
  })
})

describe("POS progress calculation and countdown", () => {
  it("calculates percentage accurately", () => {
    assert.equal(calculateProgress("0", "100.00", 6), 0)
    assert.equal(calculateProgress("25.00", "100.00", 6), 25)
    assert.equal(calculateProgress("50.00", "100.00", 6), 50)
    assert.equal(calculateProgress("100.00", "100.00", 6), 100)
    assert.equal(calculateProgress("120.00", "100.00", 6), 100)
  })

  it("formats countdown timer to MM:SS and detects expiry", () => {
    const now = 1000000
    const expiresAt = now + 125000 // 2 minutes 5 seconds
    const countdown = formatCountdown(expiresAt, now)
    assert.equal(countdown.minutes, 2)
    assert.equal(countdown.seconds, 5)
    assert.equal(countdown.formatted, "02:05")
    assert.equal(countdown.isExpired, false)

    const expiredCountdown = formatCountdown(now - 1000, now)
    assert.equal(expiredCountdown.formatted, "00:00")
    assert.equal(expiredCountdown.isExpired, true)
  })
})

describe("POS URI generation", () => {
  it("builds standard SEP-7 URI for Stellar XLM and USDC", () => {
    const xlmUri = buildPosPaymentUri({
      chain: "stellar",
      recipientAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "15.5",
      asset: "XLM",
      note: "Table 3",
    })
    assert.match(xlmUri, /^web\+stellar:pay\?/)
    assert.match(xlmUri, /destination=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5/)
    assert.match(xlmUri, /amount=15\.5/)

    const usdcUri = buildPosPaymentUri({
      chain: "stellar",
      recipientAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "25",
      asset: "USDC",
    })
    assert.match(usdcUri, /asset_code=USDC/)
    assert.match(usdcUri, /asset_issuer=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5/)
  })

  it("builds standard EIP-681 URI for Base", () => {
    const baseUri = buildPosPaymentUri({
      chain: "base",
      recipientAddress: "0x1234567890123456789012345678901234567890",
      amount: "10",
      asset: "USDC",
    })
    assert.match(baseUri, /^ethereum:0x/)
    assert.match(baseUri, /transfer\?address=0x1234567890123456789012345678901234567890/)
  })
})
