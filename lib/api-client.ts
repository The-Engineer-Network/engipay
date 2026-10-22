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
  readSessionToken,
  writeSessionToken,
  clearSessionToken,
} from "./api.ts"
import { apiRequest, apiPublicRequest } from "./api.ts"

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
  status: "pending" | "accepted" | "declined" | "expired"
  expires_at: string
  created_at: string
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

/** POST /v1/auth/verify-evm — verify an EVM wallet signature and start a session. */
export async function verifyEvmSignIn(params: {
  message: string
  signature: string
  address: string
}): Promise<SessionResponse> {
  const result = await apiPublicRequest<SessionResponse>("/v1/auth/verify-evm", {
    method: "POST",
    body: JSON.stringify(params),
  })
  if (!result) throw new Error("API did not return a session.")
  return result
}

/** POST /v1/auth/verify-stellar — verify a Stellar wallet signature and start a session. */
export async function verifyStellarSignIn(params: {
  address: string
  message: string
  signature: string
}): Promise<SessionResponse> {
  const result = await apiPublicRequest<SessionResponse>("/v1/auth/verify-stellar", {
    method: "POST",
    body: JSON.stringify(params),
  })
  if (!result) throw new Error("API did not return a session.")
  return result
}

/** GET /v1/payment-requests/:id — view invoice and payment status (public). */
export async function getPaymentRequest(id: string): Promise<PaymentRequestDetail> {
  const result = await apiPublicRequest<PaymentRequestDetail>(`/v1/payment-requests/${id}`)
  if (!result) throw new Error("API did not return payment request details.")
  return result
}

/** POST /v1/payment-requests/:id/pay — record a payment against an invoice (public). */
export async function recordPaymentRequestPayment(
  id: string,
  payment: RecordPaymentRequestInput
): Promise<RecordPaymentResponse> {
  const result = await apiPublicRequest<RecordPaymentResponse>(`/v1/payment-requests/${id}/pay`, {
    method: "POST",
    body: JSON.stringify(payment),
  })
  if (!result) throw new Error("API did not return payment confirmation.")
  return result
}

// ── Authenticated endpoints (session token required) ──────────────────────────

/** GET /v1/me — the signed-in user's tag, KYC tier and daily limit. */
export async function getMe(): Promise<MeResponse> {
  const result = await apiRequest<MeResponse>("/v1/me")
  if (!result) throw new Error("API did not return a profile.")
  return result
}

/** PATCH /v1/me — set the signed-in user's tag. */
export async function setTag(tag: string): Promise<void> {
  await apiRequest<void>("/v1/me", {
    method: "PATCH",
    body: JSON.stringify({ tag }),
  })
}

/** GET /v1/balances — the signed-in user's asset balances. */
export async function getBalances(): Promise<Balance[]> {
  const result = await apiRequest<Balance[]>("/v1/balances")
  return result ?? []
}

/** GET /v1/deposit-addresses — all deposit addresses for the signed-in user. */
export async function getDepositAddresses(): Promise<DepositAddress[]> {
  const result = await apiRequest<DepositAddress[]>("/v1/deposit-addresses")
  return result ?? []
}

/**
 * POST /v1/withdrawals — request a withdrawal.
 * The destination is screened before any hold is placed; a blocked address
 * rejects with ApiRequestError(400, "bad_request").
 */
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

/** GET /v1/withdrawals/:id — fetch a single withdrawal. */
export async function getWithdrawal(id: string): Promise<WithdrawalResponse> {
  const result = await apiRequest<WithdrawalResponse>(`/v1/withdrawals/${id}`)
  if (!result) throw new Error("API did not return a withdrawal.")
  return result
}

/** GET /v1/transactions — the signed-in user's ledger history. */
export async function getTransactions(): Promise<TransactionEntry[]> {
  const result = await apiRequest<TransactionEntry[]>("/v1/transactions")
  return result ?? []
}

/** POST /v1/auth/logout — revoke the current session. */
export async function logout(): Promise<void> {
  await apiRequest<void>("/v1/auth/logout", { method: "POST" })
}

/** POST /v1/payment-requests — create a merchant payment request / invoice. */
export async function createPaymentRequest(
  req: CreatePaymentRequestInput
): Promise<CreatePaymentRequestResponse> {
  const result = await apiRequest<CreatePaymentRequestResponse>("/v1/payment-requests", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a payment request.")
  return result
}

/** GET /v1/payment-requests — list the signed-in merchant's payment requests. */
export async function listPaymentRequests(): Promise<PaymentRequestSummary[]> {
  const result = await apiRequest<PaymentRequestSummary[]>("/v1/payment-requests")
  return result ?? []
}

// ── Batch Payments Functions (#512) ──────────────────────────────────────────

/** POST /v1/batch-payments — upload and validate a CSV batch payment file. */
export async function uploadBatchPayment(file: File | Blob): Promise<BatchPaymentStatus> {
  const formData = new FormData()
  formData.append("csv", file)

  const result = await apiRequest<BatchPaymentStatus>("/v1/batch-payments", {
    method: "POST",
    body: formData,
  })
  if (!result) throw new Error("API did not return batch payment status.")
  return result
}

/** GET /v1/batch-payments/:id — query overall status of a batch payment. */
export async function getBatchPaymentStatus(batchId: string): Promise<BatchPaymentStatus> {
  const result = await apiRequest<BatchPaymentStatus>(`/v1/batch-payments/${batchId}`)
  if (!result) throw new Error("API did not return batch payment status.")
  return result
}

/** GET /v1/batch-payments/:id/rows — query individual row results for a batch. */
export async function getBatchPaymentRows(batchId: string): Promise<RowResult[]> {
  const result = await apiRequest<RowResult[]>(`/v1/batch-payments/${batchId}/rows`)
  return result ?? []
}

/** POST /v1/batch-payments/:id/approve — approve a batch requiring a second account. */
export async function approveBatchPayment(batchId: string): Promise<void> {
  await apiRequest<void>(`/v1/batch-payments/${batchId}/approve`, {
    method: "POST",
  })
}

/** POST /v1/batch-payments/:id/execute — execute rows idempotently so re-running never pays twice. */
export async function executeBatchPayment(batchId: string): Promise<BatchPaymentStatus> {
  const result = await apiRequest<BatchPaymentStatus>(`/v1/batch-payments/${batchId}/execute`, {
    method: "POST",
  })
  if (!result) throw new Error("API did not return batch payment status.")
  return result
}

/** POST /v1/batch-payments/:id/cancel — cancel a pending batch. */
export async function cancelBatchPayment(batchId: string): Promise<void> {
  await apiRequest<void>(`/v1/batch-payments/${batchId}/cancel`, {
    method: "POST",
  })
}

// ── Naira SEP-24 Anchor Functions (#514) ──────────────────────────────────────

/** POST /v1/naira/deposits — initiate a SEP-24 deposit (NGN -> USDC). */
export async function startNairaDeposit(req: StartDepositRequest): Promise<InteractiveFlowResponse> {
  const result = await apiRequest<InteractiveFlowResponse>("/v1/naira/deposits", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return interactive flow response.")
  return result
}

/** GET /v1/naira/deposits/:id — poll the status of a Naira deposit. */
export async function getNairaDepositStatus(transactionId: string): Promise<AnchorTransactionStatus> {
  const result = await apiRequest<AnchorTransactionStatus>(`/v1/naira/deposits/${transactionId}`)
  if (!result) throw new Error("API did not return anchor deposit status.")
  return result
}

/** POST /v1/naira/withdrawals — initiate a SEP-24 withdrawal (USDC -> NGN to bank). */
export async function startNairaWithdrawal(req: StartWithdrawalRequest): Promise<InteractiveFlowResponse> {
  const result = await apiRequest<InteractiveFlowResponse>("/v1/naira/withdrawals", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return interactive flow response.")
  return result
}

/** GET /v1/naira/withdrawals/:id — poll the status of a Naira withdrawal. */
export async function getNairaWithdrawalStatus(transactionId: string): Promise<AnchorTransactionStatus> {
  const result = await apiRequest<AnchorTransactionStatus>(`/v1/naira/withdrawals/${transactionId}`)
  if (!result) throw new Error("API did not return anchor withdrawal status.")
  return result
}

