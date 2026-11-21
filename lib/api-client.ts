/**
 * Typed EngiPay API client.
 *
 * All functions are typed against the live v1 routes.  The raw transport
 * helpers (apiRequest, apiPublicRequest, ApiRequestError) live in api.ts;
 * this file adds the per-endpoint signatures so callers never have to
 * hard-code paths or cast response shapes.
 */

export {
  ApiRequestError,
  ACCOUNT_FROZEN_ERROR_CODE,
  ACCOUNT_FROZEN_EVENT,
  readSessionToken,
  writeSessionToken,
  clearSessionToken,
} from "./api.ts"
import {
  ApiRequestError,
  ACCOUNT_FROZEN_ERROR_CODE,
  apiRequest,
  apiPublicRequest,
  clearSessionToken,
} from "./api.ts"

/** Returns true only for the API's account-frozen error. */
export function isAccountFrozenError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.code === ACCOUNT_FROZEN_ERROR_CODE
}

/** Returns true only for an API response body containing account_frozen. */
export function isAccountFrozenResponse(body: unknown): boolean {
  if (!body || typeof body !== "object") return false
  const error = (body as { error?: unknown }).error
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === ACCOUNT_FROZEN_ERROR_CODE
  )
}

// ── Shared types ──────────────────────────────────────────────────────────────

export interface NetworkInfo {
  chain: string
  decimals: number
}

export interface AssetInfo {
  symbol: string
  name: string
  decimals: number
  networks: NetworkInfo[]
}

export interface MeResponse {
  tag: string | null
  tier: number
  daily_limit: string
}

export interface NonceResponse {
  nonce: string
}

export interface SessionResponse {
  token: string
  user_id: string
}

export interface StellarChallengeResponse {
  transaction: string
  network_passphrase: string
}

export interface DepositAddress {
  address: string
  asset: string
  chain: string
  memo?: string
}

export interface Balance {
  asset: string
  bucket: "available" | "held"
  amount: string
}

export interface WithdrawalRequest {
  user_id: string
  amount: number
  estimated_network_fee: number
  destination: string
}

export interface WithdrawalResponse {
  id: string
  user_id: string
  amount: number
  estimated_network_fee: number
  status: string
}

export interface TransferRequest {
  from_user_id: string
  to_tag: string
  asset: string
  amount: number
  note?: string
}

export interface TransactionEntry {
  id: string
  kind: string
  reference: string
  created_at: string
}

export interface CreatePaymentRequestInput {
  asset: string
  amount: string
  note?: string
  expiry_minutes?: number
  allow_partial?: boolean
  min_amount?: string
  max_amount?: string
}

export interface CreatePaymentRequestResponse {
  id: string
  uri: string
  expires_at: string
}

export interface PaymentEntry {
  id: string
  amount: string
  asset: string
  chain: string
  tx_hash?: string
  payer_address?: string
  note?: string
  created_at: string
}

export interface PaymentRequestDetail {
  id: string
  recipient_tag?: string
  requested_amount: string
  asset: string
  status: string
  expires_at: string
  settled_at?: string
  allow_partial: boolean
  min_amount?: string
  max_amount?: string
  amount_paid: string
  amount_remaining: string
  payments: PaymentEntry[]
}

export interface PaymentRequestSummary {
  id: string
  requested_amount: string
  asset: string
  status: string
  expires_at: string
  settled_at?: string
  allow_partial: boolean
  amount_paid: string
  amount_remaining: string
  created_at: string
}

// ── Batch Payments (#512) ─────────────────────────────────────────────────────

export interface BatchPaymentStatus {
  batch_id: string
  status: "pending" | "awaiting_approval" | "processing" | "completed" | "cancelled"
  total_rows: number
  processed_rows: number
  successful: number
  failed: number
  requires_approval: boolean
  approved_by?: string | null
}

export interface RowResult {
  row_number: number
  destination: string
  asset: string
  amount: string
  status: "pending" | "success" | "failed"
  tx_hash?: string | null
  error?: string | null
}

// ── P2P Money Requests (#510) ─────────────────────────────────────────────────

export interface MoneyRequestRow {
  id: string
  requester_tag: string | null
  recipient_tag: string | null
  asset: string
  amount: string
  note: string | null
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled"
  expires_at: string
  created_at: string
  /** True when the signed-in user created this request. */
  sent_by_me?: boolean
}

export interface CreateMoneyRequestInput {
  recipient_tag: string
  asset: string
  amount: string
  note?: string
  expiry_hours?: number
}

export interface CreateMoneyRequestResponse {
  id: string
  expires_at: string
}

/** POST /v1/money-requests — ask another EngiPay user to pay you. */
export async function createMoneyRequest(
  req: CreateMoneyRequestInput
): Promise<CreateMoneyRequestResponse> {
  const result = await apiRequest<CreateMoneyRequestResponse>("/v1/money-requests", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a money request.")
  return result
}

/** GET /v1/money-requests — inbox + outbox for the signed-in user. */
export async function listMoneyRequests(): Promise<MoneyRequestRow[]> {
  const result = await apiRequest<MoneyRequestRow[]>("/v1/money-requests")
  return result ?? []
}

/** POST /v1/money-requests/:id/accept — accept and pay a money request (once). */
export async function acceptMoneyRequest(
  id: string,
  idempotencyKey: string
): Promise<void> {
  await apiRequest<void>(`/v1/money-requests/${id}/accept`, {
    method: "POST",
    body: JSON.stringify({ idempotency_key: idempotencyKey }),
  })
}

/** POST /v1/money-requests/:id/decline — decline a money request. */
export async function declineMoneyRequest(id: string): Promise<void> {
  await apiRequest<void>(`/v1/money-requests/${id}/decline`, {
    method: "POST",
  })
}

/** POST /v1/money-requests/:id/cancel — requester cancels a pending request. */
export async function cancelMoneyRequest(id: string): Promise<void> {
  await apiRequest<void>(`/v1/money-requests/${id}/cancel`, {
    method: "POST",
  })
}

// ── Convert (#676) ────────────────────────────────────────────────────────────

export interface ConvertQuoteRequest {
  from_asset: string
  to_asset: string
  amount: string
}

export interface ConvertQuoteResponse {
  from_asset: string
  to_asset: string
  amount: string
  rate: string
  fee: string
  amount_received: string
  expires_at: string
}

export interface ExecuteConversionRequest {
  from_asset: string
  to_asset: string
  amount: string
  idempotency_key: string
}

export interface ExecuteConversionResponse {
  id: string
  from_asset: string
  to_asset: string
  amount: string
  amount_received: string
  status: string
}

/** POST /v1/convert/quote — fetch a live conversion quote. */
export async function getConvertQuote(
  req: ConvertQuoteRequest
): Promise<ConvertQuoteResponse> {
  const result = await apiRequest<ConvertQuoteResponse>("/v1/convert/quote", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a quote.")
  return result
}

/** POST /v1/convert/execute — execute a conversion using a quote. */
export async function executeConversion(
  req: ExecuteConversionRequest
): Promise<ExecuteConversionResponse> {
  const result = await apiRequest<ExecuteConversionResponse>("/v1/convert/execute", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a conversion.")
  return result
}

// ── Data export (#684) ────────────────────────────────────────────────────────

/** GET /v1/export — the signed-in user's full data export. */
export async function exportMyData(): Promise<unknown> {
  const result = await apiRequest<unknown>("/v1/export")
  if (result === undefined) throw new Error("API did not return an export.")
  return result
}

// ── Auth (#675) ───────────────────────────────────────────────────────────────

/**
 * POST /v1/auth/logout — revoke the current session token server-side.
 *
 * The local session token is cleared regardless of the server response so
 * the UI always ends up signed out, even if the token was already invalid.
 */
export async function logout(): Promise<void> {
  try {
    await apiRequest<void>("/v1/auth/logout", { method: "POST" })
  } finally {
    clearSessionToken()
  }
}

export interface InteractiveFlowResponse {
  transaction_id: string
  sep24_id: string
  interactive_url: string
  status: string
}

export interface AnchorTransactionStatus {
  transaction_id: string
  sep24_id: string
  direction: "deposit" | "withdrawal"
  status: string
  amount_requested: string
  amount_in?: string | null
  amount_out?: string | null
  amount_fee?: string | null
  stellar_tx_hash?: string | null
  status_message?: string | null
  started_at: string
  completed_at?: string | null
  deposit_transfer_id?: string | null
  withdrawal_id?: string | null
}

export interface StartDepositRequest {
  amount: string
  memo?: string
}

export interface StartWithdrawalRequest {
  amount: string
  bank_account: string
  bank_code: string
  account_name: string
}

export interface RecordPaymentRequestInput {
  amount: string
  chain: string
  tx_hash?: string
  payer_address?: string
  n

/* … truncated 486 chars — edit only what you need near the top … */
