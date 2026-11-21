/**
 * Tests for Bitcoin address validation. This check decides whether a payment
 * can be sent, so every address shape we accept and every typo we must refuse
 * is pinned here. The bech32 and bech32m fixtures are the official BIP-173 and
 * BIP-350 test vectors.
 *
 * Run with: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { checkBitcoinAddress, type BitcoinNetwork } from "./bitcoinAddress.ts"

// Base58Check: legacy P2PKH (1…/m…n…) and P2SH (3…/2…).
const MAINNET_P2PKH = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
const MAINNET_P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"
const TESTNET_P2PKH = "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn"
const TESTNET_P2SH = "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc"

// Bech32 (BIP-173): segwit v0.
const MAINNET_P2WPKH = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
const MAINNET_P2WSH = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3"
const TESTNET_P2WPKH = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
const TESTNET_P2WSH = "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7"

// Bech32m (BIP-350): segwit v1 taproot and higher versions.
const MAINNET_P2TR = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"
const TESTNET_P2TR = "tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c"

const CHECKSUM_REASON = /checksum/

function assertValid(address: string, network: BitcoinNetwork, found: BitcoinNetwork = network) {
  const result = checkBitcoinAddress(address, network)
  if (!result.valid) assert.fail(`${address} should be valid on ${network}: ${result.reason}`)
  assert.equal(result.network, found, address)
}

function assertRefused(address: string, network: BitcoinNetwork, reason?: RegExp) {
  const result = checkBitcoinAddress(address, network)
  if (result.valid) assert.fail(`${address} must be refused on ${network}`)
  if (reason) assert.match(result.reason, reason, address)
}

describe("Bitcoin legacy and P2SH addresses (Base58Check)", () => {
  it("accepts mainnet P2PKH and P2SH addresses", () => {
    assertValid(MAINNET_P2PKH, "mainnet")
    assertValid(MAINNET_P2SH, "mainnet")
  })

  it("accepts testnet P2PKH and P2SH addresses", () => {
    assertValid(TESTNET_P2PKH, "testnet")
    assertValid(TESTNET_P2SH, "testnet")
  })

  it("trims whitespace around a pasted address", () => {
    assertValid(`  ${MAINNET_P2PKH}\n`, "mainnet")
  })

  it("rejects an otherwise valid address with a changed character", () => {
    // The last character is part of the double-SHA256 checksum.
    assertRefused("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3", "mainnet", CHECKSUM_REASON)
    assertRefused("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLz", "mainnet", CHECKSUM_REASON)
    assertRefused("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfq", "testnet", CHECKSUM_REASON)
  })

  it("rejects characters that are not in the base58 alphabet", () => {
    assertRefused(`1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN0`, "mainnet")
    assertRefused(`1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVNO`, "mainnet")
    assertRefused(`1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVNI`, "mainnet")
    assertRefused(`1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVNl`, "mainnet")
  })

  it("rejects addresses of the wrong length", () => {
    assertRefused("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNV", "mainnet")
    assertRefused(`${MAINNET_P2PKH}2`, "mainnet")
  })
})

describe("Bitcoin bech32 addresses (segwit v0)", () => {
  it("accepts mainnet P2WPKH and P2WSH addresses", () => {
    assertValid(MAINNET_P2WPKH, "mainnet")
    assertValid(MAINNET_P2WSH, "mainnet")
  })

  it("accepts testnet P2WPKH and P2WSH addresses", () => {
    assertValid(TESTNET_P2WPKH, "testnet")
    assertValid(TESTNET_P2WSH, "testnet")
  })

  it("accepts the all-uppercase form used in QR codes", () => {
    assertValid("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4", "mainnet")
  })

  it("rejects a single mistyped character", () => {
    // BIP-173 invalid vector: last character changed.
    assertRefused("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5", "mainnet", CHECKSUM_REASON)
    assertRefused("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzs7", "testnet", CHECKSUM_REASON)
  })

  it("rejects mixed-case addresses", () => {
    assertRefused("tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sL5k7", "testnet")
  })

  it("refuses a v0 address carrying a bech32m checksum", () => {
    // BIP-350 invalid vector: a reader must not accept either encoding for v0.
    assertRefused("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh", "mainnet", CHECKSUM_REASON)
  })

  it("refuses a v0 program that is neither 20 nor 32 bytes", () => {
    // BIP-173 invalid vector: valid bech32, but a 16-byte program for v0.
    assertRefused("BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P", "mainnet", /Not a valid/)
  })

  it("refuses a human-readable part that is not Bitcoin's", () => {
    assertRefused("tc1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty", "testnet")
  })

  it("refuses an address with no data part", () => {
    assertRefused("bc1gmk9yu", "mainnet")
  })
})

describe("Bitcoin bech32m addresses (segwit v1 and higher)", () => {
  it("accepts mainnet and testnet taproot addresses", () => {
    assertValid(MAINNET_P2TR, "mainnet")
    assertValid(TESTNET_P2TR, "testnet")
  })

  it("accepts a higher witness version EngiPay may need one day", () => {
    // BIP-350 valid vector: witness v16, 2-byte program.
    assertValid("BC1SW50QGDZ25J", "mainnet")
  })

  it("refuses a v1 address carrying a bech32 checksum", () => {
    // BIP-350 invalid vector: bech32 used where bech32m is required.
    assertRefused("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd", "mainnet", CHECKSUM_REASON)
  })

  it("refuses a taproot address with an invalid checksum character", () => {
    // BIP-350 invalid vector: 'o' is not a bech32 character.
    assertRefused("bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4", "mainnet")
  })

  it("rejects a taproot address with a single mistyped character", () => {
    assertRefused("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jjq", "mainnet", CHECKSUM_REASON)
    assertRefused("tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0d", "testnet", CHECKSUM_REASON)
  })
})

describe("Bitcoin network mismatch", () => {
  it("refuses a testnet address when the app is on mainnet", () => {
    assertRefused(TESTNET_P2PKH, "mainnet", /testnet address/)
    assertRefused(TESTNET_P2WPKH, "mainnet", /testnet address/)
    assertRefused(TESTNET_P2TR, "mainnet", /testnet address/)
  })

  it("refuses a mainnet address when the app is on testnet", () => {
    assertRefused(MAINNET_P2PKH, "testnet", /mainnet address/)
    assertRefused(MAINNET_P2WPKH, "testnet", /mainnet address/)
    assertRefused(MAINNET_P2TR, "testnet", /mainnet address/)
  })
})

describe("Bitcoin address rejects other input", () => {
  it("refuses empty and plainly non-Bitcoin strings", () => {
    assertRefused("", "mainnet")
    assertRefused("   ", "mainnet")
    assertRefused("bitcoin", "mainnet")
    assertRefused("notanaddress", "mainnet")
  })

  it("refuses addresses belonging to another chain", () => {
    assertRefused("0x1234567890abcdef1234567890abcdef12345678", "mainnet")
    assertRefused("GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57", "mainnet")
  })
})
