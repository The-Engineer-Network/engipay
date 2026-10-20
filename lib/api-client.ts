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

export interface PaymentShare {
  payer: string
  amount: string
  status: "pending" | "paid" | "refunded"
}

export interface PaymentRequest {
  id: string
  creator: string
  asset: string
  total: string
  status: "pending" | "partially_paid" | "completed" | "cancelled"
  shares: PaymentShare[]
}

export interface Contact {
  id: string
  label: string
  identifier: string
  kind: "tag" | "address"
  chain?: string
  created_at: string
}

export interface RecipientRisk {
  identifier: string
  first_time: boolean
  look_alike: boolean
  similar_to?: string
  warnings: string[]
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

// ── Payment request splits (#483) ─────────────────────────────────────────────

/** GET /v1/payment-requests/:id — fetch a payment request with its shares. */
export async function getPaymentRequest(id: string): Promise<PaymentRequest> {
  const result = await apiRequest<PaymentRequest>(`/v1/payment-requests/${id}`)
  if (!result) throw new Error("API did not return a payment request.")
  return result
}

/**
 * POST /v1/payment-requests/:id/split — split a payment request across payers.
 * Shares (equal or custom) always sum to the request total.
 */
export async function createPaymentRequestSplit(
  id: string,
  body: { shares: Array<{ payer: string; amount: string }> }
): Promise<PaymentRequest> {
  const result = await apiRequest<PaymentRequest>(
    `/v1/payment-requests/${id}/split`,
    { method: "POST", body: JSON.stringify(body) }
  )
  if (!result) throw new Error("API did not return a payment request.")
  return result
}

/** POST /v1/payment-requests/:id/shares/:payer/pay — pay one payer's share. */
export async function payPaymentRequestShare(
  id: string,
  payer: string,
  body: { amount: string }
): Promise<PaymentRequest> {
  const result = await apiRequest<PaymentRequest>(
    `/v1/payment-requests/${id}/shares/${encodeURIComponent(payer)}/pay`,
    { method: "POST", body: JSON.stringify(body) }
  )
  if (!result) throw new Error("API did not return a payment request.")
  return result
}

/** POST /v1/payment-requests/:id/cancel — cancel and refund partial payments. */
export async function cancelPaymentRequest(id: string): Promise<PaymentRequest> {
  const result = await apiRequest<PaymentRequest>(
    `/v1/payment-requests/${id}/cancel`,
    { method: "POST" }
  )
  if (!result) throw new Error("API did not return a payment request.")
  return result
}

// ── Contacts and recipient risk (#484) ────────────────────────────────────────

/** GET /v1/contacts — the signed-in user's saved contacts. */
export async function listContacts(): Promise<Contact[]> {
  const result = await apiRequest<Contact[]>("/v1/contacts")
  return result ?? []
}

/** POST /v1/contacts — save a new contact. */
export async function createContact(body: {
  label: string
  identifier: string
  kind: "tag" | "address"
  chain?: string
}): Promise<Contact> {
  const result = await apiRequest<Contact>("/v1/contacts", {
    method: "POST",
    body: JSON.stringify(body),
  })
  if (!result) throw new Error("API did not return a contact.")
  return result
}

/** PATCH /v1/contacts/:id — update a saved contact. */
export async function updateContact(
  id: string,
  body: {
    label?: string
    identifier?: string
    kind?: "tag" | "address"
    chain?: string
  }
): Promise<Contact> {
  const result = await apiRequest<Contact>(`/v1/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
  if (!result) throw new Error("API did not return a contact.")
  return result
}

/** DELETE /v1/contacts/:id — remove a saved contact. */
export async function deleteContact(id: string): Promise<void> {
  await apiRequest<void>(`/v1/contacts/${id}`, { method: "DELETE" })
}

/**
 * GET /v1/recipients/:identifier/risk — first-time and look-alike warnings
 * for a recipient before sending.
 */
export async function getRecipientRisk(
  identifier: string
): Promise<RecipientRisk> {
  const result = await apiRequest<RecipientRisk>(
    `/v1/recipients/${encodeURIComponent(identifier)}/risk`
  )
  if (!result) throw new Error("API did not return recipient risk.")
  return result
}
