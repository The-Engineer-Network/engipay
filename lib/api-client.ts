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

// ── Balances & transactions (#671) ────────────────────────────────────────────

export interface BalancesResponse {
  balances: Balance[]
}

export interface TransactionsResponse {
  transactions: TransactionEntry[]
  next_cursor?: string | null
}

/** GET /v1/balances — the signed-in user's balances. */
export async function getBalances(): Promise<BalancesResponse> {
  const result = await apiRequest<BalancesResponse>("/v1/balances")
  return result ?? { balances: [] }
}

/** GET /v1/transactions — paginated transaction history with an optional cursor. */
export async function getTransactions(
  cursor?: string | null
): Promise<TransactionsResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
  const result = await apiRequest<TransactionsResponse>(`/v1/transactions${query}`)
  return result ?? { transactions: [], next_cursor: null }
}

// ── Receive & Send (#672) ─────────────────────────────────────────────────────

export interface DepositAddressesResponse {
  addresses: DepositAddress[]
}

/** GET /v1/deposit-addresses — the signed-in user's deposit addresses. */
export async function getDepositAddresses(): Promise<DepositAddressesResponse> {
  const result = await apiRequest<DepositAddressesResponse>("/v1/deposit-addresses")
  return result ?? { addresses: [] }
}

/** POST /v1/transfers — send funds to another EngiPay user by tag. */
export async function createTransfer(
  req: TransferRequest
): Promise<TransactionEntry> {
  const result = await apiRequest<TransactionEntry>("/v1/transfers", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a transfer.")
  return result
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

// ── Bank accounts (#681) ──────────────────────────────────────────────────────

export interface BankAccount {
  id: string
  bank_name: string
  account_name: string
  /** Masked account number, e.g. "****1234". */
  masked_number: string
  created_at?: string
}

export interface AddBankAccountInput {
  bank_name: string
  account_name: string
  account_number: string
}

/** GET /v1/bank-accounts — the signed-in user's linked bank accounts. */
export async function listBankAccounts(): Promise<BankAccount[]> {
  const result = await apiRequest<BankAccount[]>("/v1/bank-accounts")
  return result ?? []
}

/** POST /v1/bank-accounts — link a new bank account. */
export async function addBankAccount(
  req: AddBankAccountInput
): Promise<BankAccount> {
  const result = await apiRequest<BankAccount>("/v1/bank-accounts", {
    method: "POST",
    body: JSON.stringify(req),
  })
  if (!result) throw new Error("API did not return a bank account.")
  return result
}

/** DELETE /v1/bank-accounts/:id — unlink a bank account. */
export async function removeBankAccount(id: string): Promise<void> {
  await apiRequest<void>(`/v1/bank-accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

// ── Convert (#676) ───────────────────────────────

/* … truncated 1406 chars — edit only what you need near the top … */


// ── Payment Requests (#690, #620, #730) ───────────────────────────────────────

/** GET /v1/payment-requests/:id — public, no auth required. */
export async function getPaymentRequest(id: string): Promise<PaymentRequestDetail> {
  const result = await apiPublicRequest<PaymentRequestDetail>(
    `/v1/payment-requests/${encodeURIComponent(id)}`
  )
  if (!result) throw new Error("API did not return a payment request.")
  return result
}

/** POST /v1/payment-requests — create a new payment request (authenticated). */
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

/** GET /v1/payment-requests — list the signed-in user's payment requests. */
export async function listPaymentRequests(): Promise<PaymentRequestSummary[]> {
  const result = await apiRequest<PaymentRequestSummary[]>("/v1/payment-requests")
  return result ?? []
}

export interface PayPaymentRequestInput {
  amount: string
  idempotency_key: string
}

/** POST /v1/payment-requests/:id/pay — pay a request from EngiPay balance. */
export async function payPaymentRequest(
  id: string,
  req: PayPaymentRequestInput
): Promise<void> {
  await apiRequest<void>(`/v1/payment-requests/${encodeURIComponent(id)}/pay`, {
    method: "POST",
    body: JSON.stringify(req),
  })
}
