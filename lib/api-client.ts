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

// ── Data export (#684) ────────────────────────────────────────────────────────

/** GET /v1/export — the signed-in user's full data export. */
export async function exportMyData(): Promise<unknown> {
  const result = await apiRequest<unknown>("/v1/export")
  if (result === undefined) throw new Error("API did not return an export.")
  return result
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
  note?: string
}

export interface RecordPaymentResponse {
  payment_id: string
  payment_request_id: string
  request_status: string
  amount_paid: string
  amount_remaining: string
}

// ── Public endpoints (no session required) ────────────────────────────────────

/** GET /v1/assets — assets EngiPay supports, with their networks. */
export async function getAssets(): Promise<AssetInfo[]> {
  const result = await apiPublicRequest<AssetInfo[]>("/v1/assets")
  return result ?? []
}

/** POST /v1/auth/nonce — issue a single-use nonce for wallet sign-in. */
export async function requestNonce(): Promise<NonceResponse> {
  const result = await apiPublicRequest<NonceResponse>("/v1/auth/nonce", {
    method: "POST",
  })
  if (!result) throw new Error("API did not return a nonce.")
  return result
}

/** POST /v1/auth/verify-evm — verify an EVM wallet sign-in. */
export async function verifyEvmSignature(
  address: string,
  signature: string,
  nonce: string
): Promise<SessionResponse> {
  const result = await apiPublicRequest<SessionResponse>("/v1/auth/verify-evm", {
    method: "POST",
    body: JSON.stringify({ address, signature, nonce }),
  })
  if (!result) throw new Error("API did not return a session.")
  return result
}

/** POST /v1/auth/verify-stellar — verify a Stellar wallet sign-in. */
export async function verifyStellarSignature(
  address: string,
  signature: string,
  nonce: string
): Promise<SessionResponse> {
  const result = await apiPublicRequest<SessionResponse>("/v1/auth/verify-stellar", {
    method: "POST",
    body: JSON.stringify({ address, signature, nonce }),
  })
  if (!result) throw new Error("API did not return a session.")
  return result
}

/** POST /v1/auth/stellar/challenge — build a SEP-10 challenge transaction. */
export async function requestStellarChallenge(
  address: string
): Promise<StellarChallengeResponse> {
  const result = await apiPublicRequest<StellarChallengeResponse>(
    "/v1/auth/stellar/challenge",
    {
      method: "POST",
      body: JSON.stringify({ address }),
    }
  )
  if (!result) throw new Error("API did not return a challenge.")
  return result
}

// ── Authenticated endpoints ───────────────────────────────────────────────────

/** GET /v1/me — the signed-in user's tag, tier and daily limit. */
export async function getMe(): Promise<MeResponse> {
  const result = await apiRequest<MeResponse>("/v1/me")
  if (!result) throw new Error("API did not return account info.")
  return result
}

/** GET /v1/deposit-address — a deposit address for the given asset/chain. */
export async function getDepositAddress(
  asset: string,
  chain: string
): Promise<DepositAddress> {
  const params = new URLSearchParams({ asset, chain })
  const result = await apiRequest<DepositAddress>(
    `/v1/deposit-address?${params.toString()}`
  )
  if (!result) throw new Error("API did not return a deposit address.")
  return result
}

/** GET /v1/balances — available and held balances for the signed-in user. */
export async function getBalances(): Promise<Balance[]> {
  const result = await apiRequest<Balance[]>("/v1/balances")
  return result ?? []
}

/** POST /v1/withdrawals — request a withdrawal to an external address. */
export async function createWithdrawal(
  req: WithdrawalRequest
): Promise<WithdrawalResponse> {
  const result = await apiRequest<WithdrawalResponse>("/v1/withdrawals", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a withdrawal.")
  return result
}

/** POST /v1/transfers — send funds to another EngiPay tag. */
export async function createTransfer(req: TransferRequest): Promise<void> {
  await apiRequest<void>("/v1/transfers", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

/** GET /v1/transactions — recent transaction history for the signed-in user. */
export async function listTransactions(): Promise<TransactionEntry[]> {
  const result = await apiRequest<TransactionEntry[]>("/v1/transactions")
  return result ?? []
}

/** POST /v1/payment-requests — create a shareable payment request. */
export async function createPaymentRequest(
  req: CreatePaymentRequestInput
): Promise<CreatePaymentRequestResponse> {
  const result = await apiRequest<CreatePaymentRequestResponse>(
    "/v1/payment-requests",
    {
      method: "POST",
      body: JSON.stringify(req),
    }
  )
  if (!result) throw new Error("API did not return a payment request.")
  return result
}

/** GET /v1/payment-requests — list the signed-in user's payment requests. */
export async function listPaymentRequests(): Promise<PaymentRequestSummary[]> {
  const result = await apiRequest<PaymentRequestSummary[]>("/v1/payment-requests")
  return result ?? []
}

/** GET /v1/payment-requests/:id — full detail for a single payment request. */
export async function getPaymentRequest(id: string): Promise<PaymentRequestDetail> {
  const result = await apiRequest<PaymentRequestDetail>(`/v1/payment-requests/${id}`)
  if (!result) throw new Error("API did not return a payment request.")
  return result
}

/** POST /v1/payment-requests/:id/payments — record an on-chain payment. */
export async function recordPayment(
  id: string,
  req: RecordPaymentRequestInput
): Promise<RecordPaymentResponse> {
  const result = await apiRequest<RecordPaymentResponse>(
    `/v1/payment-requests/${id}/payments`,
    {
      method: "POST",
      body: JSON.stringify(req),
    }
  )
  if (!result) throw new Error("API did not return a payment record.")
  return result
}

/** POST /v1/batch-payments — submit a batch of transfers. */
export async function createBatchPayment(
  rows: Array<{ destination: string; asset: string; amount: string }>
): Promise<BatchPaymentStatus> {
  const result = await apiRequest<BatchPaymentStatus>("/v1/batch-payments", {
    method: "POST",
    body: JSON.stringify({ rows }),
  })
  if (!result) throw new Error("API did not return a batch.")
  return result
}

/** GET /v1/batch-payments/:id — status of a submitted batch. */
export async function getBatchPayment(id: string): Promise<BatchPaymentStatus> {
  const result = await apiRequest<BatchPaymentStatus>(`/v1/batch-payments/${id}`)
  if (!result) throw new Error("API did not return a batch.")
  return result
}

/** GET /v1/batch-payments/:id/rows — per-row results for a batch. */
export async function getBatchPaymentRows(id: string): Promise<RowResult[]> {
  const result = await apiRequest<RowResult[]>(`/v1/batch-payments/${id}/rows`)
  return result ?? []
}

/** POST /v1/anchors/deposit — start a SEP-24 deposit flow. */
export async function startDeposit(
  req: StartDepositRequest
): Promise<InteractiveFlowResponse> {
  const result = await apiRequest<InteractiveFlowResponse>("/v1/anchors/deposit", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a deposit flow.")
  return result
}

/** POST /v1/anchors/withdrawal — start a SEP-24 withdrawal flow. */
export async function startWithdrawal(
  req: StartWithdrawalRequest
): Promise<InteractiveFlowResponse> {
  const result = await apiRequest<InteractiveFlowResponse>("/v1/anchors/withdrawal", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a withdrawal flow.")
  return result
}

/** GET /v1/anchors/transactions/:id — status of an anchor transaction. */
export async function getAnchorTransaction(
  id: string
): Promise<AnchorTransactionStatus> {
  const result = await apiRequest<AnchorTransactionStatus>(
    `/v1/anchors/transactions/${id}`
  )
  if (!result) throw new Error("API did not return a transaction.")
  return result
}
