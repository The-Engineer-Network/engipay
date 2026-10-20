import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { checkTag } from "./tags.ts"

describe("checkTag", () => {
  it("accepts a tag of letters, digits and underscores", () => {
    assert.deepEqual(checkTag("alice_92"), { ok: true, tag: "alice_92" })
  })

  it("removes a leading @ and surrounding spaces", () => {
    assert.deepEqual(checkTag("  @alice  "), { ok: true, tag: "alice" })
  })

  it("accepts the shortest and longest allowed lengths", () => {
    assert.equal(checkTag("abc").ok, true)
    assert.equal(checkTag("a".repeat(20)).ok, true)
  })

  it("rejects a tag shorter than three characters or longer than twenty", () => {
    assert.equal(checkTag("ab").ok, false)
    assert.equal(checkTag("a".repeat(21)).ok, false)
  })

  it("rejects characters other than letters, digits and underscores", () => {
    for (const bad of ["alice-92", "alice 92", "alice@92", "alice.92"]) {
      assert.equal(checkTag(bad).ok, false, bad)
    }
  })

  it("rejects reserved handles regardless of case", () => {
    const result = checkTag("Support")
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, /reserved/)
  })
})
