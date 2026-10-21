/**
 * Client-side utilities and types for Naira on/off-ramp via Stellar SEP-24 anchor (#514).
 */

export interface NigerianBank {
  name: string
  code: string
}

export const SUPPORTED_NIGERIAN_BANKS: NigerianBank[] = [
  { name: "Access Bank", code: "044" },
  { name: "Guaranty Trust Bank (GTBank)", code: "058" },
  { name: "Zenith Bank", code: "057" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "United Bank for Africa (UBA)", code: "033" },
  { name: "Kuda Bank", code: "090267" },
  { name: "OPay", code: "090405" },
  { name: "PalmPay", code: "090552" },
  { name: "Stanbic IBTC Bank", code: "221" },
  { name: "Sterling Bank", code: "232" },
]

/**
 * Validates a Nigerian Bank Account Number (NUBAN).
 * Must be strictly 10 digits.
 */
export function isValidNuban(accountNumber: string): boolean {
  const trimmed = accountNumber.trim()
  return trimmed.length === 10 && /^[0-9]{10}$/.test(trimmed)
}

/**
 * Validates a Nigerian bank code.
 */
export function isValidBankCode(code: string): boolean {
  const trimmed = code.trim()
  return SUPPORTED_NIGERIAN_BANKS.some((b) => b.code === trimmed)
}

/**
 * User-friendly status message for each SEP-24 transaction state.
 */
export function getSep24StatusLabel(status: string): { label: string; description: string; isTerminal: boolean; isSuccess: boolean } {
  switch (status.toLowerCase()) {
    case "incomplete":
      return {
        label: "Awaiting Input",
        description: "Please complete the interactive verification in the anchor window.",
        isTerminal: false,
        isSuccess: false,
      }
    case "pending_user_transfer_start":
    case "pending_anchor":
      return {
        label: "Processing by Anchor",
        description: "The anchor is reviewing and processing your transfer.",
        isTerminal: false,
        isSuccess: false,
      }
    case "pending_stellar":
      return {
        label: "Moving on Stellar",
        description: "Stellar network transaction is being broadcast.",
        isTerminal: false,
        isSuccess: false,
      }
    case "pending_external":
      return {
        label: "Bank Transfer in Progress",
        description: "Funds have been dispatched to the destination bank account.",
        isTerminal: false,
        isSuccess: false,
      }
    case "completed":
      return {
        label: "Completed",
        description: "The transaction has successfully finished and funds are settled.",
        isTerminal: true,
        isSuccess: true,
      }
    case "expired":
      return {
        label: "Expired",
        description: "The interactive session timed out before completion.",
        isTerminal: true,
        isSuccess: false,
      }
    case "error":
      return {
        label: "Failed",
        description: "The anchor encountered an error processing this transaction.",
        isTerminal: true,
        isSuccess: false,
      }
    default:
      return {
        label: "In Progress",
        description: "Transaction is being processed.",
        isTerminal: false,
        isSuccess: false,
      }
  }
}
