/**
 * Typed helpers for the EngiPay backend API.
 *
 * All network shapes are derived from `lib/api-client.gen.ts`, which is
 * auto-generated from the OpenAPI document served at `/v1/openapi.json`.
 * Never add new types manually here — extend the Rust routes instead and
 * regenerate with `npm run generate:sdk`.
 *
 * Usage:
 *   import { listAssets, createQuote } from "@/lib/api"
 */

import type { components, operations } from "@/lib/api-client.gen"

// ─── Re-export the generated domain types ────────────────────────────────────

export type AssetInfo   = components["schemas"]["AssetInfo"]
export type NetworkInfo = components["schemas"]["NetworkInfo"]
export type Asset       = components["schemas"]["Asset"]
export type Chain       = components["schemas"]["Chain"]
export type Product     = components["schemas"]["Product"]
export type QuoteRequest  = components["schemas"]["QuoteRequest"]
export type QuoteResponse = components["schemas"]["QuoteResponse"]
export type SettleRequest  = components["schemas"]["SettleRequest"]
export type SettleResponse = components["schemas"]["SettleResponse"]

// ─── Response type for list_assets ───────────────────────────────────────────

type ListAssetsResponse =
  operations["list_assets"]["responses"]["200"]["content"]["application/json"]

// ─── Base URL ─────────────────────────────────────────────────────────────────

/** Backend base URL.  Override with NEXT_PUBLIC_API_URL for production. */
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"

// ─── Error type ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

// ─── Internal helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  })

  if (!res.ok) {
    let code = "unknown"
    let message = res.statusText
    try {
      const body = await res.json() as { error?: { code?: string; message?: string } }
      code    = body.error?.code    ?? code
      message = body.error?.message ?? message
    } catch {
      // Body was not JSON; use statusText.
    }
    throw new ApiError(res.status, code, message)
  }

  return res.json() as Promise<T>
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * GET /v1/assets
 *
 * Returns every asset the backend can move.  The result is stable for the
 * lifetime of a page; cache it with SWR or React Query rather than calling
 * this on every render.
 */
export async function listAssets(): Promise<ListAssetsResponse> {
  return apiFetch<ListAssetsResponse>("/v1/assets")
}

/**
 * POST /v1/quotes
 *
 * Locks in the fee for a given (product, asset, gross_minor) triple.
 * Returns a `QuoteResponse` that is valid for 5 minutes.  Pass the
 * `quote_id` to `settleHold` when the user confirms.
 *
 * Throws `ApiError` if the product/asset combination has no schedule
 * (404) or the gross amount is invalid (400).
 */
export async function createQuote(req: QuoteRequest): Promise<QuoteResponse> {
  return apiFetch<QuoteResponse>("/v1/quotes", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

/**
 * POST /v1/settles
 *
 * Settles a hold against a previously issued quote.  Idempotent: retrying
 * with the same `hold_reference` returns the original result.
 *
 * Throws `ApiError` with status 503 when the database is unavailable,
 * and 400 when the quote has expired or the hold reference is empty.
 */
export async function settleHold(req: SettleRequest): Promise<SettleResponse> {
  return apiFetch<SettleResponse>("/v1/settles", {
    method: "POST",
    body: JSON.stringify(req),
  })
}
