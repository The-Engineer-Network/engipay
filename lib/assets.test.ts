/**
 * Tests for the display asset list. This list is what the user is told they
 * hold, so it must include Bitcoin while staying honest that Bitcoin cannot
 * be sent yet.
 *
 * Run with: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { DISPLAY_ASSETS, type DisplayAsset } from "./assets.ts"

function bySymbol(symbol: string): DisplayAsset {
  const asset = DISPLAY_ASSETS.find((candidate) => candidate.symbol === symbol)
  assert.ok(asset, `${symbol} should be listed`)
  return asset
}

describe("DISPLAY_ASSETS", () => {
  it("shows Bitcoin as held but not sendable", () => {
    const btc = bySymbol("BTC")
    assert.equal(btc.name, "Bitcoin")
    assert.deepEqual(btc.chains, ["bitcoin"])
    assert.equal(btc.sendable, false, "Bitcoin has no sending service yet")
  })

  it("marks the currencies it can move as sendable", () => {
    for (const symbol of ["ETH", "USDC", "XLM"]) {
      assert.equal(bySymbol(symbol).sendable, true, symbol)
    }
  })

  it("shows USDC on both Base and Stellar", () => {
    const usdc = bySymbol("USDC")
    assert.deepEqual(usdc.chains, ["base", "stellar"])
    assert.equal(usdc.sendable, true)
    assert.match(usdc.name, /Stellar/)
  })

  it("names only networks the app supports", () => {
    const supported = new Set(["base", "bitcoin", "stellar"])
    for (const asset of DISPLAY_ASSETS) {
      assert.ok(asset.chains.length > 0, `${asset.symbol} has no network`)
      for (const chain of asset.chains) {
        assert.ok(supported.has(chain), `${asset.symbol} names an unsupported network: ${chain}`)
      }
    }
  })

  it("lists each currency once, under a name", () => {
    const symbols = DISPLAY_ASSETS.map((asset) => asset.symbol)
    assert.equal(new Set(symbols).size, symbols.length, "duplicate symbol")
    for (const asset of DISPLAY_ASSETS) assert.notEqual(asset.name.trim(), "", asset.symbol)
  })

  it("treats Bitcoin as the only asset that cannot be sent", () => {
    for (const asset of DISPLAY_ASSETS) {
      assert.equal(asset.sendable, asset.symbol !== "BTC", asset.symbol)
    }
  })
})
