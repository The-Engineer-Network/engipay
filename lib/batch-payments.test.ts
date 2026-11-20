/**
 * Unit tests for batch payments CSV parsing, validation, and idempotency logic (#512).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  isDestinationValid,
  isAmountValid,
  parseAndValidateCsv,
  filterRowsForExecution,
  APPROVAL_THRESHOLD_USDC,
} from "./batch-payments.ts"

describe("Batch Payments - Destination Validation", () => {
  it("accepts valid Stellar G and M addresses", () => {
    assert.ok(isDestinationValid("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"))
    assert.ok(
      isDestinationValid("MDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCYAAAAAAAAAABUR6BK")
    )
  })

  it("accepts valid EVM addresses", () => {
    assert.ok(isDestinationValid("0x71C7656EC7ab88b098defB751B7401B5f6d8976F"))
    assert.ok(isDestinationValid("0x0000000000000000000000000000000000000000"))
  })

  it("accepts valid Bitcoin addresses", () => {
    assert.ok(isDestinationValid("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"))
    assert.ok(isDestinationValid("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"))
  })

  it("accepts valid EngiPay tags", () => {
    assert.ok(isDestinationValid("@alice"))
    assert.ok(isDestinationValid("@bob_payroll"))
    assert.ok(isDestinationValid("supplier_42"))
  })

  it("rejects invalid or malformed destinations", () => {
    assert.equal(isDestinationValid(""), false)
    assert.equal(isDestinationValid("0x123"), false)
    assert.equal(isDestinationValid("GSHORT"), false)
    assert.equal(isDestinationValid("!@#$%^&*()"), false)
  })
})

describe("Batch Payments - Amount Validation", () => {
  it("accepts positive decimal numbers", () => {
    assert.ok(isAmountValid("10"))
    assert.ok(isAmountValid("10.50"))
    assert.ok(isAmountValid("0.001"))
  })

  it("rejects zero, negative, and invalid characters", () => {
    assert.equal(isAmountValid("0"), false)
    assert.equal(isAmountValid("-5.0"), false)
    assert.equal(isAmountValid(""), false)
    assert.equal(isAmountValid("ten"), false)
    assert.equal(isAmountValid("10.5.5"), false)
  })
})

describe("Batch Payments - CSV Parsing & Validation", () => {
  it("parses valid CSV and calculates totals", () => {
    const csv = `destination,asset,amount,memo
GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5,USDC,250.00,payroll
0x71C7656EC7ab88b098defB751B7401B5f6d8976F,USDC,100.50,
@alice,USDC,50.00,stipend`

    const summary = parseAndValidateCsv(csv)
    assert.equal(summary.totalRows, 3)
    assert.equal(summary.validRows, 3)
    assert.equal(summary.invalidRows, 0)
    assert.equal(summary.estimatedTotalUsd, 400.5)
    assert.equal(summary.requiresApproval, false)
  })

  it("flags rows with errors without failing whole summary", () => {
    const csv = `destination,asset,amount,memo
GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5,USDC,50.00,good
0xinvalid_address,USDC,10.00,bad_dest
@alice,DOGE,100.00,bad_asset
@bob,USDC,-5.00,bad_amount`

    const summary = parseAndValidateCsv(csv)
    assert.equal(summary.totalRows, 4)
    assert.equal(summary.validRows, 1)
    assert.equal(summary.invalidRows, 3)
    assert.equal(summary.rows[0].isValid, true)
    assert.equal(summary.rows[1].isValid, false)
    assert.equal(summary.rows[2].isValid, false)
    assert.equal(summary.rows[3].isValid, false)
  })

  it("triggers approval requirement when total exceeds threshold", () => {
    const csv = `destination,asset,amount,memo
@alice,USDC,800.00,part1
@bob,USDC,600.00,part2`

    const summary = parseAndValidateCsv(csv)
    assert.ok(summary.estimatedTotalUsd > APPROVAL_THRESHOLD_USDC)
    assert.equal(summary.requiresApproval, true)
  })
})

describe("Batch Payments - Idempotency Guarantees", () => {
  it("never pays a row twice on re-run: filters out successful or hashed rows", () => {
    const rows = [
      { rowNumber: 1, destination: "@alice", status: "success", tx_hash: "0xabc1" },
      { rowNumber: 2, destination: "@bob", status: "pending", tx_hash: null },
      { rowNumber: 3, destination: "@charlie", status: "failed", tx_hash: null },
      { rowNumber: 4, destination: "@david", status: "success", tx_hash: "0xabc4" },
    ]

    const executableRows = filterRowsForExecution(rows)
    assert.equal(executableRows.length, 2)
    assert.equal(executableRows[0].rowNumber, 2)
    assert.equal(executableRows[1].rowNumber, 3)
    // Rows 1 and 4 are completely omitted from execution!
  })
})
