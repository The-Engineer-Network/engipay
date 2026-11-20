/** Base URL of the EngiPay API, from NEXT_PUBLIC_API_URL. Empty when unset. */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "")

/** localStorage key the signed-in session token is kept under. */
export const SESSION_TOKEN_KEY = "engipay-token"

/** A failed API call. `code` is the stable error code the API returns. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.code = code
  }
}

/** The signed-in session token, or null when nobody is signed in. */
export function readSessionToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY)
  } catch {
    return null
  }
}

/** Keeps the session token after a successful sign-in. */
export function writeSessionToken(token: string): void {
  try {
    window.localStorage.setItem(SESSION_TOKEN_KEY, token)
  } catch {
    // Storage is unavailable (private mode, blocked). The user stays signed out.
  }
}

/** Forgets the session token. */
export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

async function send<T>(path: string, init: RequestInit, token: string | null): Promise<T | undefined> {
  if (!API_BASE_URL) {
    throw new ApiRequestError(503, "api_not_configured", "The EngiPay API is not configured for this build.")
  }

  const headers = new Headers(init.headers)
  if (token) headers.set("Authorization", `Bearer ${token}`)
  if (init.body !== undefined && !(typeof FormData !== "undefined" && init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  if (response.ok) {
    if (response.status === 204) return undefined
    return (await response.json()) as T
  }

  // An expired or revoked session: forget it, so the screen asks to sign in again.
  if (response.status === 401 && token) clearSessionToken()

  let code = "request_failed"
  let message = `The request failed (${response.status}).`
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
  } catch {
    // The body was not JSON; keep the generic message.
  }
  throw new ApiRequestError(response.status, code, message)
}

/**
 * Calls the EngiPay API as the signed-in user. Throws an ApiRequestError with
 * the API's own message, so screens can show it as it is. Returns undefined
 * for 204 No Content.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T | undefined> {
  const token = readSessionToken()
  if (!token) {
    throw new ApiRequestError(401, "unauthorized", "Sign in to continue.")
  }
  return send<T>(path, init, token)
}

/** Calls an endpoint that needs no session, such as the sign-in steps. */
export async function apiPublicRequest<T>(path: string, init: RequestInit = {}): Promise<T | undefined> {
  return send<T>(path, init, null)
}
