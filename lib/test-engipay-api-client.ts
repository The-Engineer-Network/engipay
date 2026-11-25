/**
 * Test-only replacement for `@/lib/api-client` in the EngiPay hook tests.
 *
 * It re-exports the real client and adds the two endpoint wrappers the hooks
 * call. Requests still go through apiRequest, so URL building, the session
 * header and API error messages are the real ones; only global fetch is
 * stubbed by the tests.
 */
export * from "./api-client.ts"
import { apiRequest } from "./api.ts"

export interface TestTransactionFilters {
  kind?: string
  startDate?: string
  endDate?: string
}

export interface TestTransactionPage {
  items: Array<{
    id: string
    type: string
    direction: "credit" | "debit"
    amount: string
    asset: string
    created_at: string
    status: "completed" | "pending" | "failed"
  }>
  next_cursor: string | null
}

export interface TestBalancesResponse {
  balances: Array<{ asset: string; available: string; held: string }>
}

export const apiClient = {
  async getTransactions(
    options: {
      limit: number
      cursor?: string | null
      filters?: TestTransactionFilters
    },
    token: string
  ): Promise<TestTransactionPage> {
    if (!token) throw new Error("A session token is required")

    const query = new URLSearchParams({ limit: String(options.limit) })
    if (options.cursor) query.set("cursor", options.cursor)
    if (options.filters?.kind) query.set("kind", options.filters.kind)
    if (options.filters?.startDate) query.set("start_date", options.filters.startDate)
    if (options.filters?.endDate) query.set("end_date", options.filters.endDate)

    const page = await apiRequest<TestTransactionPage>(
      `/v1/transactions?${query.toString()}`
    )
    return page ?? { items: [], next_cursor: null }
  },
}

export async function getEngiPayBalances(
  token: string
): Promise<TestBalancesResponse> {
  if (!token) throw new Error("A session token is required")

  const data = await apiRequest<TestBalancesResponse>("/v1/balances")
  return data ?? { balances: [] }
}
