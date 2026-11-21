import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildSignInMessage } from "./siwe.ts"

describe("buildSignInMessage", () => {
  const issuedAt = new Date("2026-10-18T20:00:00.000Z")

  it("puts the nonce on its own Nonce line, where the API looks for it", () => {
    const message = buildSignInMessage({ address: "0xabc", nonce: "f00dfeed12345678", issuedAt })
    assert.ok(message.split("\n").includes("Nonce: f00dfeed12345678"))
  })

  it("names the address and the issue time", () => {
    const message = buildSignInMessage({ address: "0xabc", nonce: "f00dfeed12345678", issuedAt })
    assert.ok(message.split("\n").includes("Address: 0xabc"))
    assert.ok(message.includes("Issued At: 2026-10-18T20:00:00.000Z"))
  })
})
