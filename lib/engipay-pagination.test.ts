/** Unit tests for the pure EngiPay transaction page-merging helpers. */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  hasMoreAfterFirstPage,
  hasMoreAfterNextPage,
  mergeTransactionItems,
  type EngiPayTransaction,
  type TransactionPage,
} from "./engipay-pagination.ts"

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

function page(ids: string[], nextCursor: string | null): TransactionPage {
  return { items: ids.map(transaction), next_cursor: nextCursor }
}

describe("mergeTransactionItems", () => {
  it("returns the first page unchanged", () => {
    const first = page(["a", "b"], "cursor-2")

    assert.deepEqual(mergeTransactionItems([], first.items), first.items)
  })

  it("appends the next page after the current items", () => {
    const merged = mergeTransactionItems(
      [transaction("a")],
      page(["b"], null).items
    )

    assert.deepEqual(
      merged.map((item) => item.id),
      ["a", "b"]
    )
  })

  it("keeps the last page without duplicating earlier items", () => {
    const current = [transaction("a"), transaction("b")]
    const merged = mergeTransactionItems(current, page([], null).items)

    assert.deepEqual(
      merged.map((item) => item.id),
      ["a", "b"]
    )
  })

  it("caps the result at maxItems while appending", () => {
    const merged = mergeTransactionItems(
      [transaction("a"), transaction("b")],
      page(["c", "d"], "cursor-4").items,
      3
    )

    assert.deepEqual(
      merged.map((item) => item.id),
      ["a", "b", "c"]
    )
  })

  it("caps the first page at maxItems without mutating the page", () => {
    const first = page(["a", "b", "c"], "cursor-2")
    const merged = mergeTransactionItems([], first.items, 2)

    assert.deepEqual(
      merged.map((item) => item.id),
      ["a", "b"]
    )
    assert.equal(first.items.length, 3)
  })
})

describe("hasMoreAfterFirstPage", () => {
  it("reports more pages when the API returns a cursor", () => {
    assert.equal(hasMoreAfterFirstPage(page(["a"], "cursor-2")), true)
  })

  it("reports the end of the list when there is no cursor", () => {
    assert.equal(hasMoreAfterFirstPage(page(["a"], null)), false)
  })

  it("reports the end of the list once maxItems is reached", () => {
    assert.equal(hasMoreAfterFirstPage(page(["a", "b", "c"], "cursor-2"), 2), false)
    assert.equal(hasMoreAfterFirstPage(page(["a"], "cursor-2"), 2), true)
  })
})

describe("hasMoreAfterNextPage", () => {
  it("tracks the cursor returned with the next page", () => {
    assert.equal(hasMoreAfterNextPage(page(["b"], "cursor-3")), true)
    assert.equal(hasMoreAfterNextPage(page(["b"], null)), false)
  })
})
