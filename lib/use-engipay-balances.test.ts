/** Tests for useEngiPayBalances: signed out, success and API error states. */
import { register } from "node:module"
import { after, afterEach, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { installHookEnv, jsonResponse, waitFor } from "./test-hook-env.ts"

// The hooks use the "@/" alias and import React hooks. Redirect those to the
// test-only resolver before dynamically importing the hook below.
register("./test-engipay-hook-hooks.mjs", import.meta.url)

type UseEngiPayBalances = typeof import("../hooks/use-engipay-balances.ts").useEngiPayBalances
type RenderHook = typeof import("./test-hook-react.ts").renderHook

let useEngiPayBalances: UseEngiPayBalances
let renderHook: RenderHook
let env: ReturnType<typeof installHookEnv> | undefined

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL

before(async () => {
  process.env.NEXT_PUBLIC_API_URL = "http://test.local"
  ;({ useEngiPayBalances } = await import("../hooks/use-engipay-balances.ts"))
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

describe("useEngiPayBalances", () => {
  it("stays empty and does not fetch when signed out", () => {
    env = installHookEnv(null, () => {
      throw new Error("fetch must not be called when signed out")
    })

    const view = renderHook(() => useEngiPayBalances())

    assert.deepEqual(view.current.balances, [])
    assert.equal(view.current.isLoading, false)
    assert.equal(view.current.error, null)
    assert.equal(env.calls.length, 0)
    view.unmount()
  })

  it("loads balances with the stored session token", async () => {
    const balances = [
      { asset: "USDC", available: "12.5", held: "0.25" },
      { asset: "XLM", available: "340", held: "0" },
    ]
    env = installHookEnv("session-token", () => jsonResponse({ balances }))

    const view = renderHook(() => useEngiPayBalances())
    await waitFor(() => !view.current.isLoading && view.current.balances.length === 2)

    assert.deepEqual(view.current.balances, balances)
    assert.equal(view.current.error, null)
    assert.equal(env.calls.length, 1)
    assert.equal(env.calls[0].url, "http://test.local/v1/balances")
    assert.equal(
      new Headers(env.calls[0].init?.headers).get("Authorization"),
      "Bearer session-token"
    )
    view.unmount()
  })

  it("surfaces the API error message and stops loading", async () => {
    env = installHookEnv("session-token", () =>
      jsonResponse(
        { error: { code: "internal", message: "Balances unavailable" } },
        500
      )
    )

    const view = renderHook(() => useEngiPayBalances())
    await waitFor(() => view.current.error !== null)

    assert.equal(view.current.error, "Balances unavailable")
    assert.deepEqual(view.current.balances, [])
    assert.equal(view.current.isLoading, false)
    view.unmount()
  })
})
