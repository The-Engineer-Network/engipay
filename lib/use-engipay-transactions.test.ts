/**
 * Tests for useEngiPayTransactions: signed out, first page, next page, end of
 * list, maxItems, and API error states with a stubbed fetch.
 */
import { register } from "node:module"
import { after, afterEach, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import type { EngiPayTransaction } from "./engipay-pagination.ts"
import { installHookEnv, jsonResponse, waitFor } from "./test-hook-env.ts"

register("./test-engipay-hook-hooks.mjs", import.meta.url)

type UseEngiPayTransactions =
  typeof import("../hooks/use-engipay-transactions.ts").useEngiPayTransactions
type RenderHook = typeof import("./test-hook-react.ts").renderHook

let useEngiPayTransactions: UseEngiPayTransactions
let renderHook: RenderHook
let env: ReturnType<typeof installHookEnv> | undefined

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL

function transaction(id: string): EngiPayTransaction {
  return {
    id,
    type: "transfer",
    direction: "debit",
    amount: "1.00",
    asset: "USDC",
    created_at: "2026-01-01T00:00:00Z",
    status: "completed",
  }
}

before(async () => {
  process.env.NEXT_PUBLIC_API_URL = "http://test.local"
  ;({ useEngiPayTransactions } = await import(
    "../hooks/use-engipay-transactions.ts"
  ))
  ;({ renderHook } = await import("./test-hook-react.ts"))
})

afterEach(() => {
  env?.restore()
  env = undefined
})

after(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl
})

describe("useEngiPayTransactions", () => {
  it("stays empty and does not fetch when signed out", () => {
    env = installHookEnv(null, () => {
      throw new Error("fetch must not be called when signed out")
    })

    const view = renderHook(() => useEngiPayTransactions())

    assert.deepEqual(view.current.transactions, [])
    assert.equal(view.current.isLoading, false)
    assert.equal(view.current.isLoadingMore, false)
    assert.equal(view.current.hasMore, false)
    assert.equal(view.current.error, null)
    assert.equal(env.calls.length, 0)
    view.unmount()
  })

  it("loads the first page and reports that more pages exist", async () => {
    env = installHookEnv("session-token", () =>
      jsonResponse({
        items: [transaction("a"), transaction("b")],
        next_cursor: "cursor-2",
      })
    )

    const view = renderHook(() => useEngiPayTransactions({ limit: 2 }))
    await waitFor(
      () => !view.current.isLoading && view.current.transactions.length === 2
    )

    assert.deepEqual(
      view.current.transactions.map((item) => item.id),
      ["a", "b"]
    )
    assert.equal(view.current.hasMore, true)
    assert.equal(view.current.error, null)
    assert.equal(env.calls.length, 1)
    assert.equal(env.calls[0].url, "http://test.local/v1/transactions?limit=2")
    view.unmount()
  })

  it("appends the next page with the cursor and detects the end of the list", async () => {
    let request = 0
    env = installHookEnv("session-token", () => {
      request += 1
      return request === 1
        ? jsonResponse({ items: [transaction("a")], next_cursor: "cursor-2" })
        : jsonResponse({ items: [transaction("b")], next_cursor: null })
    })

    const view = renderHook(() => useEngiPayTransactions({ limit: 1 }))
    await waitFor(
      () => !view.current.isLoading && view.current.transactions.length === 1
    )
    assert.equal(view.current.hasMore, true)

    view.current.loadMore()
    await waitFor(
      () =>
        !view.current.isLoadingMore && view.current.transactions.length === 2
    )

    assert.deepEqual(
      view.current.transactions.map((item) => item.id),
      ["a", "b"]
    )
    assert.equal(view.current.hasMore, false)
    assert.equal(env.calls.length, 2)
    assert.equal(
      env.calls[1].url,
      "http://test.local/v1/transactions?limit=1&cursor=cursor-2"
    )
    view.unmount()
  })

  it("does not request another page after the end of the list", async () => {
    env = installHookEnv("session-token", () =>
      jsonResponse({ items: [transaction("a")], next_cursor: null })
    )

    const view = renderHook(() => useEngiPayTransactions())
    await waitFor(
      () => !view.current.isLoading && view.current.transactions.length === 1
    )
    assert.equal(view.current.hasMore, false)

    view.current.loadMore()
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.equal(env.calls.length, 1)
    view.unmount()
  })

  it("stops after maxItems is reached on the first page", async () => {
    env = installHookEnv("session-token", () =>
      jsonResponse({
        items: [transaction("a"), transaction("b"), transaction("c")],
        next_cursor: "cursor-3",
      })
    )

    const view = renderHook(() =>
      useEngiPayTransactions({ limit: 3, maxItems: 2 })
    )
    await waitFor(
      () => !view.current.isLoading && view.current.transactions.length === 2
    )

    assert.deepEqual(
      view.current.transactions.map((item) => item.id),
      ["a", "b"]
    )
    assert.equal(view.current.hasMore, false)
    view.unmount()
  })

  it("caps the list at maxItems when appending a next page", async () => {
    let request = 0
    env = installHookEnv("session-token", () => {
      request += 1
      return request === 1
        ? jsonResponse({
            items: [transaction("a"), transaction("b")],
            next_cursor: "cursor-2",
          })
        : jsonResponse({
            items: [transaction("c"), transaction("d")],
            next_cursor: "cursor-4",
          })
    })

    const view = renderHook(() =>
      useEngiPayTransactions({ limit: 2, maxItems: 3 })
    )
    await waitFor(
      () => !view.current.isLoading && view.current.transactions.length === 2
    )
    assert.equal(view.current.hasMore, true)

    view.current.loadMore()
    await waitFor(
      () => !view.current.isLoadingMore && view.current.transactions.length === 3
    )

    assert.deepEqual(
      view.current.transactions.map((item) => item.id),
      ["a", "b", "c"]
    )
    assert.equal(env.calls.length, 2)
    view.unmount()
  })

  it("surfaces the API error message and stops loading", async () => {
    env = installHookEnv("session-token", () =>
      jsonResponse(
        { error: { code: "internal", message: "Transactions unavailable" } },
        500
      )
    )

    const view = renderHook(() => useEngiPayTransactions())
    await waitFor(() => view.current.error !== null)

    assert.equal(view.current.error, "Transactions unavailable")
    assert.deepEqual(view.current.transactions, [])
    assert.equal(view.current.isLoading, false)
    assert.equal(view.current.hasMore, false)
    view.unmount()
  })
})
