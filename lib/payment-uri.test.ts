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
  isStellarAccount,
  isStellarAddress,
  isStellarSecretKey,
  parsePaymentCode,
  shortenAddress,
  toBaseUnits,
} from "./payment-uri.ts"

const EVM = "0x1234567890abcdef1234567890abcdef12345678"
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const BTC_BECH32 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
const BTC_LEGACY = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

// Generated with the Stellar Development Foundation's @stellar/stellar-base from
// a seed of 32 bytes of 7s, so these also check our strkey code against theirs.
// The secret key is a public test fixture that has never held funds.
const STELLAR = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57"
const STELLAR_MUXED = "MDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCYAAAAAAAAAABUR6BK"
const STELLAR_SECRET = "SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X"
const STELLAR_CONTRACT = "CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U"
const USDC_ISSUER_TESTNET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"

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

describe("Stellar address checks", () => {
  it("accepts accounts and muxed accounts", () => {
    assert.equal(isStellarAddress(STELLAR), true)
    assert.equal(isStellarAddress(STELLAR_MUXED), true)
    assert.equal(isStellarAddress(`  ${STELLAR}
`), true)
    assert.equal(isStellarAccount(USDC_ISSUER_TESTNET), true)
  })

  it("only treats G addresses as plain accounts", () => {
    assert.equal(isStellarAccount(STELLAR_MUXED), false)
  })

  it("catches a single mistyped character through the checksum", () => {
    const typo = STELLAR.slice(0, 20) + (STELLAR[20] === "A" ? "B" : "A") + STELLAR.slice(21)
    assert.equal(isStellarAddress(typo), false)
  })

  it("refuses lowercase, contracts, secret keys and other chains", () => {
    assert.equal(isStellarAddress(STELLAR.toLowerCase()), false)
    assert.equal(isStellarAddress(STELLAR_CONTRACT), false)
    assert.equal(isStellarAddress(STELLAR_SECRET), false)
    assert.equal(isStellarAddress(EVM), false)
    assert.equal(isStellarAddress(BTC_BECH32), false)
  })

  it("recognises a secret key by name so the app can warn about it", () => {
    assert.equal(isStellarSecretKey(STELLAR_SECRET), true)
    assert.equal(isStellarSecretKey(STELLAR), false)
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

describe("Stellar payment codes (SEP-7)", () => {
  it("reads a bare Stellar address", () => {
    const result = parsePaymentCode(STELLAR_MUXED)
    assert.equal(result?.chain, "stellar")
    assert.equal(result?.address, STELLAR_MUXED)
  })

  it("reads a native XLM request", () => {
    const result = parsePaymentCode(`web+stellar:pay?destination=${STELLAR}&amount=12.5`)
    assert.equal(result?.chain, "stellar")
    assert.equal(result?.asset, "XLM")
    assert.equal(result?.amount, "12.5")
    assert.equal(result?.assetIssuer, undefined)
  })

  it("reads a USDC request with its issuer and memo", () => {
    const result = parsePaymentCode(
      `web+stellar:pay?destination=${STELLAR}&amount=10&asset_code=USDC&asset_issuer=${USDC_ISSUER_TESTNET}&memo=12345&memo_type=MEMO_ID&msg=Lunch`
    )
    assert.equal(result?.asset, "USDC")
    assert.equal(result?.assetIssuer, USDC_ISSUER_TESTNET)
    assert.deepEqual(result?.memo, { type: "id", value: "12345" })
    assert.equal(result?.reference, "Lunch")
  })

  it("defaults a memo with no type to text", () => {
    const result = parsePaymentCode(`web+stellar:pay?destination=${STELLAR}&memo=invoice%2042`)
    assert.deepEqual(result?.memo, { type: "text", value: "invoice 42" })
  })

  it("refuses codes that would be paid wrongly if half understood", () => {
    const bad = [
      // No or invalid destination.
      "web+stellar:pay?amount=1",
      `web+stellar:pay?destination=${STELLAR.toLowerCase()}`,
      // An asset without an issuer, or an issuer that is not an account.
      `web+stellar:pay?destination=${STELLAR}&asset_code=USDC`,
      `web+stellar:pay?destination=${STELLAR}&asset_code=USDC&asset_issuer=${STELLAR_MUXED}`,
      // More than seven decimals, or not a number.
      `web+stellar:pay?destination=${STELLAR}&amount=1.00000001`,
      `web+stellar:pay?destination=${STELLAR}&amount=-1`,
      // A memo EngiPay cannot attach: a hash, a text memo over 28 bytes, an id over 64 bits.
      `web+stellar:pay?destination=${STELLAR}&memo=abc&memo_type=MEMO_HASH`,
      `web+stellar:pay?destination=${STELLAR}&memo=${"x".repeat(29)}`,
      `web+stellar:pay?destination=${STELLAR}&memo=18446744073709551616&memo_type=MEMO_ID`,
    ]
    for (const code of bad) assert.equal(parsePaymentCode(code), null, code)
  })

  it("does not accept a transaction-signing request as a payment", () => {
    assert.equal(parsePaymentCode("web+stellar:tx?xdr=AAAA"), null)
  })

  it("reads a Stellar EngiPay envelope from its embedded URI", () => {
    const raw = buildEngipayRequest({
      chain: "stellar",
      address: STELLAR,
      amount: "5",
      asset: "USDC",
      assetIssuer: USDC_ISSUER_TESTNET,
      reference: "inv_7",
    })
    const result = parsePaymentCode(raw)
    assert.equal(result?.chain, "stellar")
    assert.equal(result?.asset, "USDC")
    assert.equal(result?.assetIssuer, USDC_ISSUER_TESTNET)
    assert.equal(result?.reference, "inv_7")
  })

  it("refuses an envelope whose URI pays someone other than its recipient", () => {
    const other = buildPaymentUri({ chain: "stellar", address: STELLAR_MUXED, amount: "5" })
    const raw = JSON.stringify({ type: "engipay.request", chain: "stellar", to: STELLAR, uri: other })
    assert.equal(parsePaymentCode(raw), null)
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

  it("round-trips a Stellar USDC request with a memo", () => {
    const uri = buildPaymentUri({
      chain: "stellar",
      address: STELLAR,
      amount: "7.25",
      asset: "USDC",
      assetIssuer: USDC_ISSUER_TESTNET,
      memo: { type: "text", value: "rent" },
    })
    const parsed = parsePaymentCode(uri)
    assert.equal(parsed?.address, STELLAR)
    assert.equal(parsed?.amount, "7.25")
    assert.equal(parsed?.asset, "USDC")
    assert.deepEqual(parsed?.memo, { type: "text", value: "rent" })
  })

  it("builds a plain XLM request without asset parameters", () => {
    assert.equal(
      buildPaymentUri({ chain: "stellar", address: STELLAR, asset: "XLM" }),
      `web+stellar:pay?destination=${STELLAR}`
    )
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
