/**
 * Tests for payment-code parsing. This code decides where money is sent, so
 * every shape we accept, and every shape we must refuse, is pinned here.
 *
 * Run with: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildEngipayRequest,
  buildPaymentUri,
  isBitcoinAddress,
  isEvmAddress,
  parsePaymentCode,
  shortenAddress,
  toBaseUnits,
} from "./payment-uri.ts"

const EVM = "0x1234567890abcdef1234567890abcdef12345678"
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const BTC_BECH32 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
const BTC_LEGACY = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

const usdcDecimals = (contract: string) =>
  contract.toLowerCase() === USDC_BASE.toLowerCase() ? 6 : undefined

describe("address checks", () => {
  it("accepts a well-formed EVM address", () => {
    assert.equal(isEvmAddress(EVM), true)
  })

  it("rejects EVM addresses of the wrong length or with bad characters", () => {
    assert.equal(isEvmAddress("0x1234"), false)
    assert.equal(isEvmAddress(EVM + "00"), false)
    assert.equal(isEvmAddress("0xZZ34567890abcdef1234567890abcdef12345678"), false)
  })

  it("accepts bech32 and legacy Bitcoin addresses", () => {
    assert.equal(isBitcoinAddress(BTC_BECH32), true)
    assert.equal(isBitcoinAddress(BTC_LEGACY), true)
  })

  it("rejects things that are not Bitcoin addresses", () => {
    assert.equal(isBitcoinAddress(EVM), false)
    assert.equal(isBitcoinAddress("bitcoin"), false)
  })
})

describe("toBaseUnits", () => {
  it("converts human amounts without floating point error", () => {
    assert.equal(toBaseUnits("1.5", 6), "1500000")
    assert.equal(toBaseUnits("25", 6), "25000000")
    assert.equal(toBaseUnits("0.000001", 6), "1")
    // 0.1 + 0.2 style float bugs must not appear.
    assert.equal(toBaseUnits("0.3", 18), "300000000000000000")
  })

  it("truncates digits beyond the token's precision rather than rounding up", () => {
    assert.equal(toBaseUnits("1.1234567", 6), "1123456")
  })

  it("handles leading-dot and zero amounts", () => {
    assert.equal(toBaseUnits(".5", 6), "500000")
    assert.equal(toBaseUnits("0", 6), "0")
  })
})

describe("parsePaymentCode", () => {
  it("returns null for empty or unrecognised input", () => {
    assert.equal(parsePaymentCode(""), null)
    assert.equal(parsePaymentCode("   "), null)
    assert.equal(parsePaymentCode("hello world"), null)
    assert.equal(parsePaymentCode("https://example.com"), null)
  })

  it("reads a bare EVM address as a Base payment", () => {
    const result = parsePaymentCode(`  ${EVM}  `)
    assert.equal(result?.chain, "base")
    assert.equal(result?.address, EVM)
    assert.equal(result?.amount, undefined)
  })

  it("reads a bare Bitcoin address", () => {
    const result = parsePaymentCode(BTC_BECH32)
    assert.equal(result?.chain, "bitcoin")
    assert.equal(result?.asset, "BTC")
  })

  it("reads an EIP-681 native payment and converts wei to ETH", () => {
    const result = parsePaymentCode(`ethereum:${EVM}@8453?value=1500000000000000000`)
    assert.equal(result?.chain, "base")
    assert.equal(result?.address, EVM)
    assert.equal(result?.amount, "1.5")
  })

  it("reads an EIP-681 token transfer using the token's decimals", () => {
    const result = parsePaymentCode(
      `ethereum:${USDC_BASE}@8453/transfer?address=${EVM}&uint256=25000000`,
      usdcDecimals
    )
    assert.equal(result?.address, EVM, "money must go to the recipient, not the token contract")
    assert.equal(result?.tokenAddress, USDC_BASE)
    assert.equal(result?.amount, "25")
  })

  it("refuses a token transfer whose recipient is not a valid address", () => {
    assert.equal(
      parsePaymentCode(`ethereum:${USDC_BASE}@8453/transfer?address=0xnope&uint256=1`),
      null
    )
  })

  it("accepts Base Sepolia codes during development", () => {
    const result = parsePaymentCode(`ethereum:${EVM}@84532`)
    assert.equal(result?.chain, "base")
  })

  it("does not treat a code for another network as a Base payment", () => {
    // Paying a mainnet request on Base sends money the recipient may never see.
    const result = parsePaymentCode(`ethereum:${EVM}@1?value=1000000000000000000`)
    assert.notEqual(result, null, "the code is still readable")
    assert.equal(result?.chainId, 1)
    assert.equal(result?.supportedNetwork, false)
  })

  it("marks Base codes as a supported network", () => {
    assert.equal(parsePaymentCode(`ethereum:${EVM}@8453`)?.supportedNetwork, true)
    assert.equal(parsePaymentCode(EVM)?.supportedNetwork, true)
  })

  it("reads a BIP-21 Bitcoin request with amount and message", () => {
    const result = parsePaymentCode(`bitcoin:${BTC_BECH32}?amount=0.0015&message=Lunch`)
    assert.equal(result?.chain, "bitcoin")
    assert.equal(result?.address, BTC_BECH32)
    assert.equal(result?.amount, "0.0015")
    assert.equal(result?.reference, "Lunch")
  })

  it("refuses a BIP-21 code with an invalid address", () => {
    assert.equal(parsePaymentCode("bitcoin:notanaddress?amount=1"), null)
  })

  it("reads an EngiPay envelope", () => {
    const raw = JSON.stringify({
      v: 1,
      type: "engipay.request",
      chain: "base",
      to: EVM,
      asset: "USDC",
      amount: "25.00",
      ref: "inv_123",
    })
    const result = parsePaymentCode(raw)
    assert.equal(result?.address, EVM)
    assert.equal(result?.asset, "USDC")
    assert.equal(result?.amount, "25.00")
    assert.equal(result?.reference, "inv_123")
  })

  it("refuses an EngiPay envelope with no recipient", () => {
    assert.equal(parsePaymentCode(JSON.stringify({ type: "engipay.request", amount: "5" })), null)
  })

  it("refuses an EngiPay envelope whose recipient is not a valid address", () => {
    const raw = JSON.stringify({ type: "engipay.request", chain: "base", to: "0xnope" })
    assert.equal(parsePaymentCode(raw), null)
  })

  it("ignores JSON that is not an EngiPay request", () => {
    assert.equal(parsePaymentCode(JSON.stringify({ to: EVM })), null)
  })
})

describe("building codes", () => {
  it("round-trips a native Base request", () => {
    const uri = buildPaymentUri({ chain: "base", address: EVM, amount: "0.25" })
    const parsed = parsePaymentCode(uri)
    assert.equal(parsed?.address, EVM)
    assert.equal(parsed?.amount, "0.25")
  })

  it("round-trips a USDC request", () => {
    const uri = buildPaymentUri({
      chain: "base",
      address: EVM,
      amount: "12.5",
      tokenAddress: USDC_BASE,
      tokenDecimals: 6,
    })
    const parsed = parsePaymentCode(uri, usdcDecimals)
    assert.equal(parsed?.address, EVM)
    assert.equal(parsed?.tokenAddress, USDC_BASE)
    assert.equal(parsed?.amount, "12.5")
  })

  it("round-trips a Bitcoin request", () => {
    const uri = buildPaymentUri({ chain: "bitcoin", address: BTC_BECH32, amount: "0.01" })
    assert.equal(uri, `bitcoin:${BTC_BECH32}?amount=0.01`)
    assert.equal(parsePaymentCode(uri)?.amount, "0.01")
  })

  it("builds an open request with no amount", () => {
    assert.equal(buildPaymentUri({ chain: "base", address: EVM }), `ethereum:${EVM}@8453`)
  })

  it("embeds the standard URI inside an EngiPay envelope", () => {
    const envelope = JSON.parse(
      buildEngipayRequest({ chain: "base", address: EVM, amount: "3", asset: "ETH" })
    )
    assert.equal(envelope.type, "engipay.request")
    assert.equal(envelope.uri, buildPaymentUri({ chain: "base", address: EVM, amount: "3" }))
  })
})

describe("shortenAddress", () => {
  it("keeps the start and end of a long address", () => {
    assert.equal(shortenAddress(EVM), "0x1234…5678")
  })

  it("leaves short strings untouched", () => {
    assert.equal(shortenAddress("0x12"), "0x12")
  })
})
