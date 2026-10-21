/**
 * Tests for building Stellar payments. fetch is replaced with an in-memory
 * Horizon, so no network call is made.
 *
 * Run with: npm test
 */
import { register } from "node:module"
import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { Keypair, Memo, TransactionBuilder } from "@stellar/stellar-base"

// stellar-tx.ts imports with the "@/" alias; teach node's loader about it
// before the module is loaded.
register("./test-alias-hooks.mjs", import.meta.url)

const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
const DESTINATION = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
const TESTNET = "Test SDF Network ; September 2015"

interface Horizon {
  accounts: Record<string, unknown>
  requests: string[]
  paths: unknown[]
}

const horizon: Horizon = { accounts: {}, requests: [], paths: [] }
const realFetch = globalThis.fetch

function account(xlm: string, usdc?: string, subentries = 0) {
  return {
    sequence: "100",
    subentry_count: subentries,
    balances: [
      { asset_type: "native", balance: xlm },
      ...(usdc
        ? [
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
              balance: usdc,
            },
          ]
        : []),
    ],
  }
}

let build: typeof import("./stellar-tx.ts").buildStellarPayment
let buildPath: typeof import("./stellar-tx.ts").buildStellarPathPayment

before(async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    horizon.requests.push(url)
    if (url.endsWith("/fee_stats")) {
      return new Response(JSON.stringify({ fee_charged: { p70: "100" } }), { status: 200 })
    }
    if (url.includes("/paths/")) {
      return new Response(JSON.stringify({ _embedded: { records: horizon.paths } }), { status: 200 })
    }
    const id = decodeURIComponent(url.split("/accounts/")[1] ?? "")
    const record = horizon.accounts[id]
    return record
      ? new Response(JSON.stringify(record), { status: 200 })
      : new Response("{}", { status: 404 })
  }) as typeof fetch
  ;({ buildStellarPayment: build, buildStellarPathPayment: buildPath } = await import("./stellar-tx.ts"))
})

after(() => {
  globalThis.fetch = realFetch
})

function setup(source: unknown, destination?: unknown) {
  horizon.accounts = { [SOURCE]: source }
  if (destination) horizon.accounts[DESTINATION] = destination
  horizon.requests = []
  horizon.paths = []
}

function decode(xdr: string) {
  return TransactionBuilder.fromXDR(xdr, TESTNET) as ReturnType<typeof TransactionBuilder.fromXDR> & {
    operations: Array<Record<string, any>>
    memo: Memo
  }
}

describe("buildStellarPayment", () => {
  it("builds an XLM payment without a memo", async () => {
    setup(account("100.0000000"), account("5.0000000"))
    const built = await build({ source: SOURCE, destination: DESTINATION, amount: "10.5", asset: "XLM" })
    const tx = decode(built.xdr)
    assert.equal(built.createsAccount, false)
    assert.equal(tx.operations.length, 1)
    assert.equal(tx.operations[0].type, "payment")
    assert.equal(tx.operations[0].destination, DESTINATION)
    assert.equal(tx.operations[0].amount, "10.5000000")
    assert.equal(tx.operations[0].asset.isNative(), true)
    assert.equal(tx.memo.type, "none")
  })

  it("builds a USDC payment with a text memo", async () => {
    setup(account("10.0000000", "50.0000000", 1), account("5.0000000", "0.0000000", 1))
    const built = await build({
      source: SOURCE,
      destination: DESTINATION,
      amount: "20",
      asset: "USDC",
      memo: { type: "text", value: "invoice 7" },
    })
    const tx = decode(built.xdr)
    assert.equal(tx.operations[0].type, "payment")
    assert.equal(tx.operations[0].asset.code, "USDC")
    assert.equal(tx.operations[0].asset.issuer, SOURCE)
    assert.equal(tx.memo.type, "text")
    assert.equal(tx.memo.value?.toString(), "invoice 7")
  })

  it("builds an XLM payment with an id memo", async () => {
    setup(account("100.0000000"), account("5.0000000"))
    const built = await build({
      source: SOURCE,
      destination: DESTINATION,
      amount: "1",
      asset: "XLM",
      memo: { type: "id", value: "12345" },
    })
    const tx = decode(built.xdr)
    assert.equal(tx.memo.type, "id")
    assert.equal(String(tx.memo.value), "12345")
  })

  it("creates the account when the recipient does not exist yet", async () => {
    setup(account("100.0000000"))
    const built = await build({ source: SOURCE, destination: DESTINATION, amount: "2", asset: "XLM" })
    assert.equal(built.createsAccount, true)
    assert.equal(decode(built.xdr).operations[0].type, "createAccount")
  })

  it("refuses a bad address, and a secret key with a warning", async () => {
    setup(account("100.0000000"))
    await assert.rejects(
      build({ source: SOURCE, destination: "GNOTANADDRESS", amount: "1", asset: "XLM" }),
      /not a valid Stellar address/
    )
    await assert.rejects(
      build({ source: SOURCE, destination: Keypair.random().secret(), amount: "1", asset: "XLM" }),
      /secret key/
    )
    assert.equal(horizon.requests.length, 0)
  })

  it("refuses too many decimals, zero and negative amounts", async () => {
    setup(account("100.0000000"))
    for (const amount of ["1.12345678", "0", "0.0000000", "-1", "abc", ""]) {
      await assert.rejects(
        build({ source: SOURCE, destination: DESTINATION, amount, asset: "XLM" }),
        /greater than zero/,
        `amount ${JSON.stringify(amount)}`
      )
    }
    assert.equal(horizon.requests.length, 0)
  })

  it("refuses XLM above the spendable balance", async () => {
    // 10 XLM, 1 XLM base reserve: at most 9 can be sent.
    setup(account("10.0000000"), account("5.0000000"))
    await assert.rejects(
      build({ source: SOURCE, destination: DESTINATION, amount: "9.0000001", asset: "XLM" }),
      /at most 9 XLM/
    )
    const ok = await build({ source: SOURCE, destination: DESTINATION, amount: "9", asset: "XLM" })
    assert.ok(ok.xdr)
  })

  it("refuses USDC above the balance or without a trustline", async () => {
    setup(account("10.0000000", "5.0000000", 1), account("5.0000000", "0", 1))
    await assert.rejects(
      build({ source: SOURCE, destination: DESTINATION, amount: "5.0000001", asset: "USDC" }),
      /Not enough USDC/
    )
    setup(account("10.0000000"), account("5.0000000", "0", 1))
    await assert.rejects(
      build({ source: SOURCE, destination: DESTINATION, amount: "1", asset: "USDC" }),
      /Not enough USDC/
    )
  })

  it("refuses USDC to a recipient with no trustline or no account", async () => {
    setup(account("10.0000000", "50.0000000", 1), account("5.0000000"))
    await assert.rejects(
      build({ source: SOURCE, destination: DESTINATION, amount: "1", asset: "USDC" }),
      /cannot receive USDC yet/
    )
    setup(account("10.0000000", "50.0000000", 1))
    await assert.rejects(
      build({ source: SOURCE, destination: DESTINATION, amount: "1", asset: "USDC" }),
      /does not exist yet/
    )
  })

  it("refuses paying yourself and a first payment under 1 XLM", async () => {
    setup(account("100.0000000"))
    await assert.rejects(
      build({ source: SOURCE, destination: SOURCE, amount: "1", asset: "XLM" }),
      /your own account/
    )
    await assert.rejects(
      build({ source: SOURCE, destination: DESTINATION, amount: "0.5", asset: "XLM" }),
      /at least 1 XLM/
    )
  })
})

describe("buildStellarPathPayment", () => {
  it("builds a strict-send path payment from XLM to USDC", async () => {
    setup(account("100.0000000"), account("5.0000000", "0.0000000", 1))
    horizon.paths = [
      {
        source_amount: "10.0000000",
        destination_amount: "2.0000000",
        path: [],
        source_asset_type: "native",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: SOURCE,
      },
    ]
    const built = await buildPath({
      source: SOURCE,
      destination: DESTINATION,
      sendAsset: "XLM",
      sendAmount: "10",
      destAsset: "USDC",
      slippage: "0.01",
    })
    const tx = decode(built.xdr)
    assert.equal(tx.operations.length, 1)
    assert.equal(tx.operations[0].type, "pathPaymentStrictSend")
    assert.equal(tx.operations[0].sendAsset.isNative(), true)
    assert.equal(tx.operations[0].sendAmount, "10.0000000")
    assert.equal(tx.operations[0].destAsset.code, "USDC")
    assert.equal(tx.operations[0].destMin, "1.9800000")
    assert.ok(horizon.requests.some((u) => u.includes("/paths/")))
  })

  it("rejects when the quoted path exceeds the slippage limit", async () => {
    setup(account("100.0000000"), account("5.0000000", "0.0000000", 1))
    horizon.paths = [
      {
        source_amount: "10.0000000",
        destination_amount: "1.0000000",
        path: [],
        source_asset_type: "native",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: SOURCE,
      },
    ]
    await assert.rejects(
      buildPath({
        source: SOURCE,
        destination: DESTINATION,
        sendAsset: "XLM",
        sendAmount: "10",
        destAsset: "USDC",
        slippage: "0.01",
        minDestAmount: "1.5",
      }),
      /slippage/
    )
  })
})
