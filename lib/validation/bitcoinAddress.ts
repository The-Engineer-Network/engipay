/**
 * Bitcoin address validation with checksums: Base58Check for legacy and
 * P2SH addresses, bech32 (BIP-173) for segwit v0 and bech32m (BIP-350) for
 * segwit v1+ such as taproot. No dependency beyond viem's sha256.
 */
import { sha256 } from "viem"

export type BitcoinNetwork = "mainnet" | "testnet"

export type BitcoinAddressCheck =
  | { valid: true; network: BitcoinNetwork }
  | { valid: false; reason: string }

/** The network the app runs on, from NEXT_PUBLIC_CHAIN_ENV. Read lazily. */
export function activeBitcoinNetwork(): BitcoinNetwork {
  return process.env.NEXT_PUBLIC_CHAIN_ENV === "mainnet" ? "mainnet" : "testnet"
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const BECH32_CONST = 1
const BECH32M_CONST = 0x2bc830a3

function doubleSha256(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes, "bytes"), "bytes")
}

function decodeBase58(text: string): Uint8Array | null {
  let value = 0n
  for (const char of text) {
    const digit = BASE58.indexOf(char)
    if (digit === -1) return null
    value = value * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  for (const char of text) {
    if (char !== "1") break
    bytes.unshift(0)
  }
  return Uint8Array.from(bytes)
}

function checkBase58(text: string, network: BitcoinNetwork): BitcoinAddressCheck {
  const bytes = decodeBase58(text)
  if (!bytes || bytes.length !== 25) {
    return { valid: false, reason: "Not a valid Bitcoin address." }
  }
  const payload = bytes.subarray(0, 21)
  const checksum = bytes.subarray(21)
  const expected = doubleSha256(payload).subarray(0, 4)
  if (checksum.some((byte, i) => byte !== expected[i])) {
    return { valid: false, reason: "The address checksum does not match. Check for a typo." }
  }
  const version = payload[0]
  const found: BitcoinNetwork | null =
    version === 0x00 || version === 0x05 ? "mainnet" : version === 0x6f || version === 0xc4 ? "testnet" : null
  if (!found) return { valid: false, reason: "Unknown Bitcoin address type." }
  return networkResult(found, network)
}

function polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const value of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= generators[i]
  }
  return chk >>> 0
}

function convertBits(data: number[], from: number, to: number): number[] | null {
  let acc = 0
  let bits = 0
  const out: number[] = []
  for (const value of data) {
    acc = (acc << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      out.push((acc >> bits) & ((1 << to) - 1))
    }
    acc &= (1 << bits) - 1
  }
  // Padding must be fewer than `from` bits and all zero.
  if (bits >= from || acc !== 0) return null
  return out
}

function checkBech32(text: string, network: BitcoinNetwork): BitcoinAddressCheck {
  const bad = { valid: false, reason: "Not a valid Bitcoin address." } as const
  // Mixed case is invalid; all-uppercase is allowed (used in QR codes).
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return bad
  const lower = text.toLowerCase()
  const separator = lower.lastIndexOf("1")
  if (separator < 1 || separator + 7 > lower.length || lower.length > 90) return bad
  const hrp = lower.slice(0, separator)
  if (hrp !== "bc" && hrp !== "tb") return bad

  const data: number[] = []
  for (const char of lower.slice(separator + 1)) {
    const value = BECH32.indexOf(char)
    if (value === -1) return bad
    data.push(value)
  }

  const hrpValues = [...hrp].map((c) => c.charCodeAt(0))
  const expanded = [...hrpValues.map((v) => v >> 5), 0, ...hrpValues.map((v) => v & 31)]
  const constant = polymod([...expanded, ...data])
  const version = data[0]
  if (version > 16) return bad
  // BIP-350: v0 uses bech32, v1 and above use bech32m, never the other way round.
  const required = version === 0 ? BECH32_CONST : BECH32M_CONST
  if (constant !== required) {
    return { valid: false, reason: "The address checksum does not match. Check for a typo." }
  }

  const program = convertBits(data.slice(1, -6), 5, 8)
  if (!program || program.length < 2 || program.length > 40) return bad
  if (version === 0 && program.length !== 20 && program.length !== 32) return bad

  return networkResult(hrp === "bc" ? "mainnet" : "testnet", network)
}

function networkResult(found: BitcoinNetwork, expected: BitcoinNetwork): BitcoinAddressCheck {
  if (found === expected) return { valid: true, network: found }
  return {
    valid: false,
    reason:
      expected === "mainnet"
        ? "This is a testnet address, but EngiPay is running on Bitcoin mainnet."
        : "This is a mainnet address, but EngiPay is running on Bitcoin testnet.",
  }
}

/** Validates a Bitcoin address, checksum included, for the given network. */
export function checkBitcoinAddress(
  value: string,
  network: BitcoinNetwork = activeBitcoinNetwork()
): BitcoinAddressCheck {
  const text = value.trim()
  if (/^(bc|tb)1/i.test(text)) return checkBech32(text, network)
  return checkBase58(text, network)
}
