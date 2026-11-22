/**
 * Withdrawal API functions for api-client.ts
 * Add these to the existing lib/api-client.ts file
 */

// Add to existing types section:

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

export interface WithdrawalStatusResponse extends WithdrawalResponse {
  // Same as WithdrawalResponse, used for GET endpoint
}

// Add to exports section:

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
): Promise<WithdrawalStatusResponse> {
  const result = await apiRequest<WithdrawalStatusResponse>(
    `/v1/withdrawals/${encodeURIComponent(id)}`
  )
  if (!result) throw new Error("Withdrawal not found.")
  return result
}
