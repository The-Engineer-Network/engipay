/**
 * Typed EngiPay API client with withdrawal support.
 * 
 * This is a minimal API client for the withdrawal flow.
 * Extend with other endpoints as needed.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CreateWithdrawalRequest {
  asset: string
  chain: string
  destination: string
  amount: number
  estimated_network_fee: number
  idempotency_key: string
}

export interface WithdrawalResponse {
  id: string
  asset: string
  chain: string
  destination: string
  amount: string
  estimated_network_fee: string
  status: "pending" | "processing" | "completed" | "failed" | "held"
  cooling_off_until?: string | null
  tx_hash?: string | null
  created_at: string
}

// ── API Request Helper ────────────────────────────────────────────────────────

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.engipay.io"

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("engipay-token") : null

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options?.headers,
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }))
    throw new ApiError(
      error.message || `Request failed with status ${response.status}`,
      response.status,
      error.code
    )
  }

  return response.json()
}

// ── Withdrawal Functions ──────────────────────────────────────────────────────

/** POST /v1/withdrawals — create a new withdrawal. */
export async function createWithdrawal(
  req: CreateWithdrawalRequest
): Promise<WithdrawalResponse> {
  const result = await apiRequest<WithdrawalResponse>("/v1/withdrawals", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a withdrawal.")
  return result
}

/** GET /v1/withdrawals/:id — get withdrawal status. */
export async function getWithdrawalStatus(
  id: string
): Promise<WithdrawalResponse> {
  const result = await apiRequest<WithdrawalResponse>(
    `/v1/withdrawals/${encodeURIComponent(id)}`
  )
  if (!result) throw new Error("Withdrawal not found.")
  return result
}

// ── Export as apiClient ───────────────────────────────────────────────────────

export const apiClient = {
  createWithdrawal,
  getWithdrawalStatus,
}
