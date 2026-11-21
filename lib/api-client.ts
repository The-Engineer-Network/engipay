/**
 * Typed thin wrapper around the engipay REST API.
 *
 * Every function returns the parsed JSON body or throws on a non-2xx status.
 * Callers are responsible for authentication headers; this module only shapes
 * the request and response types.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ""

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`API ${res.status}: ${text || res.statusText}`)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Withdrawal types
// ---------------------------------------------------------------------------

/** Terminal statuses — once reached the page stops polling. */
export const WITHDRAWAL_FINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const

export type WithdrawalFinalStatus = (typeof WITHDRAWAL_FINAL_STATUSES)[number]

export type WithdrawalStatus =
  | "pending"
  | "held"
  | "processing"
  | WithdrawalFinalStatus

export interface Withdrawal {
  id: string
  /** Amount in the smallest currency unit (e.g. kobo, satoshi, stroops). */
  amount: number
  estimated_network_fee: number
  status: WithdrawalStatus
  /** Destination address / account. */
  destination: string
  /** On-chain transaction hash, available once broadcast. */
  tx_hash?: string | null
  /**
   * ISO-8601 timestamp until which funds are held for new-address cooling-off.
   * Present only when status is "held".
   */
  cooling_off_until?: string | null
}

// ---------------------------------------------------------------------------
// Withdrawal API calls
// ---------------------------------------------------------------------------

/** Fetch a single withdrawal by ID. */
export async function getWithdrawal(id: string): Promise<Withdrawal> {
  return apiFetch<Withdrawal>(`/withdrawals/${id}`)
}
