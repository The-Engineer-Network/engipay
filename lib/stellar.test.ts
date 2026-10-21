/**
 * Tests for the Stellar amount and balance helpers. Pure functions only, no
 * network calls.
 *
 * Run with: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  balancesFromAccount,
  checkSlippage,
  describeResultCodes,
  findStellarPath,
  fromStroops,
  toStroops,
} from "./stellar.ts"

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
const OTHER_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"

describe("toStroops and fromStroops", () => {
  it("converts exactly", () => {
    assert.equal(toStroops("12.3400000"), 123_400_000n)
    assert.equal(toStroops("1"), 10_000_000n)
    assert.equal(toStroops("0.0000001"), 1n)
  })

  it("refuses more than seven decimals and non-numbers", () => {
    assert.throws(() => toStroops("1.00000001"))
    assert.throws(() => toStroops("abc"))
    assert.throws(() => toStroops("-1"))
  })

  it("formats without trailing zeros", () => {
    assert.equal(fromStroops(123_400_000n), "12.34")
    assert.equal(fromStroops(10_000_000n), "1")
    assert.equal(fromStroops(1n), "0.0000001")
    assert.equal(fromStroops(-5_000_000n), "-0.5")
  })
})

describe("balancesFromAccount", () => {
  it("keeps the base reserve of 1 XLM for an account with no subentries", () => {
    const result = balancesFromAccount(
      { subentry_count: 0, balances: [{ asset_type: "native", balance: "10.0000000" }] },
      ISSUER
    )
    assert.equal(result.xlm, "10")
    assert.equal(result.xlmSpendable, "9")
    assert.equal(result.usdc, null)
  })

  it("reserves 0.5 XLM per subentry such as a trustline", () => {
    const result = balancesFromAccount(
      {
        subentry_count: 2,
        balances: [{ asset_type: "native", balance: "10.0000000" }],
      },
      ISSUER
    )
    assert.equal(result.xlmSpendable, "8")
  })

  it("accounts for sponsorship and selling liabilities", () => {
    const result = balancesFromAccount(
      {
        subentry_count: 0,
        num_sponsoring: 2,
        num_sponsored: 1,
        balances: [{ asset_type: "native", balance: "10.0000000", selling_liabilities: "1.5000000" }],
      },
      ISSUER
    )
    // (2 + 0 + 2 - 1) entries = 1.5 XLM locked, plus 1.5 XLM in offers.
    assert.equal(result.xlmSpendable, "7")
  })

  it("never reports a negative spendable balance", () => {
    const result = balancesFromAccount(
      { subentry_count: 4, balances: [{ asset_type: "native", balance: "1.0000000" }] },
      ISSUER
    )
    assert.equal(result.xlmSpendable, "0")
  })

  it("only counts USDC from the configured issuer", () => {
    const account = (issuer: string) => ({
      subentry_count: 1,
      balances: [
        { asset_type: "native", balance: "5.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: issuer,
          balance: "25.5000000",
        },
      ],
    })
    assert.equal(balancesFromAccount(account(ISSUER), ISSUER).usdc, "25.5")
    assert.equal(balancesFromAccount(account(OTHER_ISSUER), ISSUER).usdc, null)
  })
})

describe("findStellarPath", () => {
  const fetchJson = (body: unknown) => async () => body

  it("returns the best path with its destination amount", async () => {
    const path = await findStellarPath(
      {
        sourceAsset: "native",
        destAsset: { code: "USDC", issuer: ISSUER },
        destAmount: "10",
        fetchJson: fetchJson({
          _embedded: {
            records: [
              {
                source_amount: "12.5000000",
                destination_amount: "10.0000000",
                path: [{ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER }],
              },
            ],
          },
        }),
      }
    )
    assert.ok(path)
    assert.equal(path.sourceAmount, "12.5")
    assert.equal(path.destAmount, "10")
    assert.equal(path.path.length, 1)
  })

  it("returns null when no path exists", async () => {
    const path = await findStellarPath(
      {
        sourceAsset: "native",
        destAsset: { code: "USDC", issuer: ISSUER },
        destAmount: "10",
        fetchJson: fetchJson({ _embedded: { records: [] } }),
      }
    )
    assert.equal(path, null)
  })
})

describe("checkSlippage", () => {
  it("accepts a destination amount within the slippage bound", () => {
    assert.equal(
      checkSlippage({ quotedDestAmount: "10", actualDestAmount: "9.95", slippageBps: 100 }),
      true
    )
  })

  it("rejects a destination amount outside the slippage bound", () => {
    assert.equal(
      checkSlippage({ quotedDestAmount: "10", actualDestAmount: "9.5", slippageBps: 100 }),
      false
    )
  })
})

describe("describeResultCodes", () => {
  it("explains known codes in plain language", () => {
    assert.match(describeResultCodes({ operations: ["op_underfunded"] }), /Not enough balance/)
    assert.match(describeResultCodes({ transaction: "tx_bad_seq" }), /Try again/)
  })

  it("falls back for unknown or missing codes", () => {
    const fallback = "The Stellar network rejected the payment."
    assert.equal(describeResultCodes({ operations: ["op_mystery"] }), fallback)
    assert.equal(describeResultCodes(undefined), fallback)
  })
})
