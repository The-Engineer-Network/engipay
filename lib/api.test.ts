import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ApiRequestError, apiRequest } from "./api.ts"

describe("apiRequest", () => {
  it("refuses to call the API without a signed-in session", async () => {
    // The test runner has no window, so there is never a stored session here.
    await assert.rejects(apiRequest("/v1/me"), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError)
      assert.equal(error.status, 401)
      assert.equal(error.code, "unauthorized")
      return true
    })
  })
})
