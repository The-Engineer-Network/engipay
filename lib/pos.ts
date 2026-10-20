/**
 * EngiPay Point of Sale (POS) core logic and helpers.
 *
 * Handles:
 * - Exact integer-based decimal math (avoiding floating-point drift)
 * - Invoice lifecycle and status calculation (open, partially_paid, paid, expired)
 * - Multi-chain payment URI generation (Stellar SEP-7, Base EIP-681)
 * - High-contrast counter audio chime via Web Audio API
 * - Cross-tab real-time payment synchronization
 */

import { buildPaymentUri, type StellarMemo } from "./payment-uri.ts"
import { stellarNetwork } from "./stellar.ts"
import { TRACKED_TOKENS } from "./tokens.ts"
import { activeChain } from "./wagmi.ts"

export type PosInvoiceStatus = "open" | "partially_paid" | "paid" | "expired"
export type PosChain = "stellar" | "base" | "bitcoin"

export interface PosPaymentRecord {
  id: string
  amount: string
  asset: string
  chain: string
  txHash?: string
  payer?: string
  note?: string
  createdAt: string
}

export interface PosInvoice {
  id: string
  apiRequestId?: string
  amount: string
  asset: string
  chain: PosChain
  recipientAddress: string
  memo?: StellarMemo
  note?: string
  allowPartial: boolean
  minAmount?: string
  maxAmount?: string
  createdAt: number // Unix timestamp ms
  expiresAt: number // Unix timestamp ms
  status: PosInvoiceStatus
  amountPaid: string
  amountRemaining: string
  payments: PosPaymentRecord[]
  uri: string
}

export interface PosBroadcastPayment {
  type: "payment_received"
  recipient: string
  amount: string
  asset: string
  txHash: string
  chain: string
  requestId?: string
}

/**
 * Returns standard asset decimals for a chain to ensure lossless integer math.
 */
export function getAssetDecimals(asset: string, chain: PosChain): number {
  const normAsset = asset.toUpperCase().trim()
  if (chain === "stellar") {
    // Stellar native and issued assets both use 7 decimal places (stroops).
    return 7
  }
  if (chain === "bitcoin") {
    return 8 // satoshis
  }
  if (chain === "base") {
    if (normAsset === "ETH") return 18
    if (normAsset === "USDC") return 6
    const tracked = TRACKED_TOKENS.find(
      (t) => t.symbol.toUpperCase() === normAsset
    )
    if (tracked) return tracked.decimals
    return 18
  }
  return 7
}

/**
 * Converts a decimal string to minor integer units (BigInt) with given decimals.
 * "12.34" with 6 decimals -> 12340000n.
 */
export function toMinorUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim()
  if (!trimmed || trimmed === ".") return 0n
  const negative = trimmed.startsWith("-")
  const clean = negative ? trimmed.slice(1) : trimmed
  const [whole = "0", fraction = ""] = clean.split(".")
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals)
  const digits = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "") || "0"
  const units = BigInt(digits)
  return negative ? -units : units
}

/**
 * Converts minor integer units (BigInt) back to a normalized decimal string.
 * 12340000n with 6 decimals -> "12.34".
 */
export function fromMinorUnits(units: bigint, decimals: number): string {
  const negative = units < 0n
  const value = negative ? -units : units
  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const fractionUnits = value % divisor
  if (fractionUnits === 0n) {
    return `${negative ? "-" : ""}${whole.toString()}`
  }
  const fraction = fractionUnits
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`
}

/**
 * Adds two decimal strings with exact integer arithmetic.
 */
export function addDecimals(a: string, b: string, decimals = 7): string {
  const aMinor = toMinorUnits(a, decimals)
  const bMinor = toMinorUnits(b, decimals)
  return fromMinorUnits(aMinor + bMinor, decimals)
}

/**
 * Subtracts b from a with exact integer arithmetic (floored at 0 by default).
 */
export function subtractDecimals(
  a: string,
  b: string,
  decimals = 7,
  allowNegative = false
): string {
  const aMinor = toMinorUnits(a, decimals)
  const bMinor = toMinorUnits(b, decimals)
  const diff = aMinor - bMinor
  if (!allowNegative && diff < 0n) {
    return "0"
  }
  return fromMinorUnits(diff, decimals)
}

/**
 * Compares two decimal strings.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareDecimals(a: string, b: string, decimals = 7): number {
  const aMinor = toMinorUnits(a, decimals)
  const bMinor = toMinorUnits(b, decimals)
  if (aMinor < bMinor) return -1
  if (aMinor > bMinor) return 1
  return 0
}

/**
 * Calculates current status for a POS invoice based on payment progress and expiry.
 */
export function calculatePosStatus(
  requestedAmount: string,
  amountPaid: string,
  expiresAt: number,
  nowMs = Date.now(),
  decimals = 7
): PosInvoiceStatus {
  if (compareDecimals(amountPaid, requestedAmount, decimals) >= 0) {
    return "paid"
  }
  if (nowMs >= expiresAt) {
    return "expired"
  }
  if (compareDecimals(amountPaid, "0", decimals) > 0) {
    return "partially_paid"
  }
  return "open"
}

/**
 * Calculates payment completion percentage (0 - 100 clamped).
 */
export function calculateProgress(
  amountPaid: string,
  requestedAmount: string,
  decimals = 7
): number {
  const paidMinor = toMinorUnits(amountPaid, decimals)
  const totalMinor = toMinorUnits(requestedAmount, decimals)
  if (totalMinor <= 0n) return 0
  if (paidMinor >= totalMinor) return 100
  const pct = Number((paidMinor * 10000n) / totalMinor) / 100
  return Math.min(Math.max(pct, 0), 100)
}

/**
 * Formats remaining countdown time in MM:SS.
 */
export function formatCountdown(
  expiresAt: number,
  nowMs = Date.now()
): {
  minutes: number
  seconds: number
  formatted: string
  isExpired: boolean
} {
  const remainingMs = Math.max(0, expiresAt - nowMs)
  const totalSeconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const formatted = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`
  return {
    minutes,
    seconds,
    formatted,
    isExpired: totalSeconds === 0,
  }
}

/**
 * Builds the standard payment URI for a POS invoice.
 * Generates SEP-7 for Stellar and EIP-681 for Base.
 */
export function buildPosPaymentUri(options: {
  chain: PosChain
  recipientAddress: string
  amount: string
  asset: string
  memo?: StellarMemo
  note?: string
}): string {
  const { chain, recipientAddress, amount, asset, memo, note } = options

  if (chain === "stellar") {
    const isUsdc = asset.toUpperCase() === "USDC"
    return buildPaymentUri({
      chain: "stellar",
      address: recipientAddress,
      amount: amount && Number(amount) > 0 ? amount : undefined,
      asset: isUsdc ? "USDC" : "XLM",
      assetIssuer: isUsdc ? stellarNetwork.usdcIssuer : undefined,
      memo,
      reference: note,
    })
  }

  if (chain === "base") {
    const isEth = asset.toUpperCase() === "ETH"
    const token = !isEth
      ? TRACKED_TOKENS.find(
          (t) => t.symbol.toUpperCase() === asset.toUpperCase()
        )
      : undefined

    return buildPaymentUri({
      chain: "base",
      address: recipientAddress,
      amount: amount && Number(amount) > 0 ? amount : undefined,
      tokenAddress: token?.address,
      tokenDecimals: token?.decimals,
      chainId: activeChain.id,
      reference: note,
    })
  }

  return buildPaymentUri({
    chain: "bitcoin",
    address: recipientAddress,
    amount: amount && Number(amount) > 0 ? amount : undefined,
    reference: note,
  })
}

/**
 * Counter sound chime via Web Audio API.
 * Uses a two-tone ascending chime (E6 -> A6) suitable for a busy shop counter.
 * Requires zero external audio files and is completely resilient to network failures.
 */
export function playPosChime(): void {
  if (typeof window === "undefined") return
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    if (!AudioContextClass) return

    const ctx = new AudioContextClass()
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {})
    }

    const now = ctx.currentTime

    // Tone 1: E6 (1318.51 Hz)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = "sine"
    osc1.frequency.setValueAtTime(1318.51, now)
    gain1.gain.setValueAtTime(0.18, now)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.3)

    // Tone 2: A6 (1760.00 Hz) - Bright, unmistakable confirmation
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = "sine"
    osc2.frequency.setValueAtTime(1760.0, now + 0.12)
    gain2.gain.setValueAtTime(0.25, now + 0.12)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.12)
    osc2.stop(now + 0.55)
  } catch (err) {
    console.warn("Unable to play POS audio chime:", err)
  }
}

/** Broadcast channel for real-time POS payment sync across tabs/windows. */
const BROADCAST_CHANNEL_NAME = "engipay-pos-sync"

/**
 * Broadcasts an incoming payment notification to any listening POS counter screens.
 */
export function broadcastPosPayment(payment: PosBroadcastPayment): void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
    channel.postMessage(payment)
    channel.close()
  } catch {
    // Ignore channel broadcast errors
  }
}

/**
 * Listens for payment broadcasts on the sync channel.
 */
export function listenPosPayments(
  callback: (payment: PosBroadcastPayment) => void
): () => void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return () => {}
  }
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
    const handler = (event: MessageEvent<PosBroadcastPayment>) => {
      if (event.data && event.data.type === "payment_received") {
        callback(event.data)
      }
    }
    channel.addEventListener("message", handler)
    return () => {
      channel.removeEventListener("message", handler)
      channel.close()
    }
  } catch {
    return () => {}
  }
}
