/**
 * Client-side utilities for CSV batch payments (#512).
 *
 * Validates rows before submission, calculates totals, checks approval thresholds,
 * and tracks idempotent execution status.
 */

import { checkTag } from "./tags.ts"

export const APPROVAL_THRESHOLD_USDC = 1000

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const STRKEY_ACCOUNT = 6 << 3 // G…
const STRKEY_MUXED = 12 << 3 // M…

function decodeBase32(text: string): Uint8Array | null {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of text) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value === -1) return null
    buffer = ((buffer << 5) | value) & 0xfff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  if (bits >= 5 || (buffer & ((1 << bits) - 1)) !== 0) return null
  return Uint8Array.from(bytes)
}

function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

function strkeyVersion(value: string, length: number): number | null {
  if (value.length !== length) return null
  const bytes = decodeBase32(value)
  if (!bytes || bytes.length < 3) return null
  const body = bytes.subarray(0, bytes.length - 2)
  const checksum = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8)
  return crc16Xmodem(body) === checksum ? bytes[0] : null
}

export function isStellarAddress(value: string): boolean {
  const text = value.trim()
  return (
    strkeyVersion(text, 56) === STRKEY_ACCOUNT || strkeyVersion(text, 69) === STRKEY_MUXED
  )
}

export interface ParsedCsvRow {
  rowNumber: number
  destination: string
  asset: string
  amount: string
  memo?: string
  isValid: boolean
  error?: string
}

export interface BatchSummary {
  rows: ParsedCsvRow[]
  totalRows: number
  validRows: number
  invalidRows: number
  estimatedTotalUsd: number
  requiresApproval: boolean
}

/**
 * Validates a destination address or EngiPay handle.
 * Accepts Stellar public keys (G...) and muxed keys (M...),
 * EVM addresses (0x... 42 hex chars), Bitcoin addresses, and @tags.
 */
export function isDestinationValid(dest: string): boolean {
  const trimmed = dest.trim()
  if (!trimmed) return false

  // EVM address (0x + 40 hex chars = 42 chars)
  if (trimmed.startsWith("0x")) {
    return trimmed.length === 42 && /^0x[0-9a-fA-F]{40}$/.test(trimmed)
  }

  // Stellar G... or M... with checksum validation
  if (trimmed.startsWith("G") || trimmed.startsWith("M")) {
    return isStellarAddress(trimmed)
  }

  // Bitcoin address (bc1, 1, or 3)
  if (trimmed.startsWith("bc1") || trimmed.startsWith("1") || trimmed.startsWith("3")) {
    return trimmed.length >= 26 && trimmed.length <= 62 && /^[a-zA-Z0-9]+$/.test(trimmed)
  }

  // EngiPay tag (@alice, supplier_42)
  const tagResult = checkTag(trimmed)
  if (tagResult.ok) {
    return true
  }

  return false
}

/**
 * Validates an amount string.
 * Must be a positive decimal number with appropriate precision.
 */
export function isAmountValid(amount: string): boolean {
  const trimmed = amount.trim()
  if (!trimmed) return false
  const num = parseFloat(trimmed)
  if (isNaN(num) || num <= 0) return false
  return /^[0-9]+(\.[0-9]+)?$/.test(trimmed)
}

/**
 * Parses and validates raw CSV text on the client before upload.
 */
export function parseAndValidateCsv(csvText: string): BatchSummary {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length <= 1) {
    return {
      rows: [],
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      estimatedTotalUsd: 0,
      requiresApproval: false,
    }
  }

  const headerLine = lines[0].toLowerCase()
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""))

  const destIdx = headers.findIndex((h) => h === "destination" || h === "recipient" || h === "address")
  const assetIdx = headers.findIndex((h) => h === "asset" || h === "token" || h === "currency")
  const amountIdx = headers.findIndex((h) => h === "amount" || h === "value")
  const memoIdx = headers.findIndex((h) => h === "memo" || h === "note" || h === "reference")

  const rows: ParsedCsvRow[] = []
  let totalEstimatedUsd = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    // Simple CSV row parser (handles standard commas)
    const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""))

    const destination = destIdx !== -1 && parts[destIdx] ? parts[destIdx] : parts[0] ?? ""
    const asset = (assetIdx !== -1 && parts[assetIdx] ? parts[assetIdx] : parts[1] ?? "").toUpperCase()
    const amount = amountIdx !== -1 && parts[amountIdx] ? parts[amountIdx] : parts[2] ?? ""
    const memo = memoIdx !== -1 && parts[memoIdx] ? parts[memoIdx] : parts[3] || undefined

    let isValid = true
    let error: string | undefined

    if (!isDestinationValid(destination)) {
      isValid = false
      error = "Invalid recipient address or handle"
    } else if (!["USDC", "XLM", "ETH", "BTC"].includes(asset)) {
      isValid = false
      error = `Unsupported asset '${asset}' (use XLM, USDC, ETH, or BTC)`
    } else if (!isAmountValid(amount)) {
      isValid = false
      error = "Amount must be a positive number"
    } else if (memo && new TextEncoder().encode(memo).length > 28) {
      isValid = false
      error = "Memo exceeds maximum of 28 bytes"
    }

    if (isValid) {
      const parsedAmount = parseFloat(amount)
      if (asset === "USDC") totalEstimatedUsd += parsedAmount
      else if (asset === "XLM") totalEstimatedUsd += parsedAmount * 0.1
      else totalEstimatedUsd += APPROVAL_THRESHOLD_USDC + 1 // Flag high value assets
    }

    rows.push({
      rowNumber: i,
      destination,
      asset,
      amount,
      memo,
      isValid,
      error,
    })
  }

  const validRows = rows.filter((r) => r.isValid).length
  const invalidRows = rows.length - validRows
  const requiresApproval = totalEstimatedUsd > APPROVAL_THRESHOLD_USDC

  return {
    rows,
    totalRows: rows.length,
    validRows,
    invalidRows,
    estimatedTotalUsd: Math.round(totalEstimatedUsd * 100) / 100,
    requiresApproval,
  }
}

/**
 * Filter out already paid rows for safe, idempotent re-running.
 * Never executes a row that was already marked as successful.
 */
export function filterRowsForExecution<T extends { status: string; tx_hash?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.status !== "success" && !r.tx_hash)
}
