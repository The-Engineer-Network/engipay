import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { getSendStatusAnnouncement } from "./sendStatus.ts"

describe("getSendStatusAnnouncement", () => {
  it("stays silent while the form is idle", () => {
    assert.equal(getSendStatusAnnouncement({ phase: "idle" }), "")
  })

  it("announces a waiting state with its detail", () => {
    assert.equal(
      getSendStatusAnnouncement({ phase: "waiting", detail: "Check your wallet to approve the request." }),
      "Sending payment. Check your wallet to approve the request."
    )
    assert.equal(getSendStatusAnnouncement({ phase: "waiting" }), "Sending payment.")
  })

  it("announces success without leaking stale error details", () => {
    assert.equal(getSendStatusAnnouncement({ phase: "success" }), "Payment sent successfully.")
    assert.equal(
      getSendStatusAnnouncement({ phase: "success", detail: "ignored" }),
      "Payment sent successfully."
    )
  })

  it("announces an error with its detail", () => {
    assert.equal(getSendStatusAnnouncement({ phase: "error", detail: "Invalid address." }), "Payment failed. Invalid address.")
    assert.equal(getSendStatusAnnouncement({ phase: "error" }), "Payment failed.")
  })
})
