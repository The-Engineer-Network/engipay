/**
 * Tests for the tracked token list. Decimals decide how many base units a
 * transfer sends and the address decides which contract moves them, so both
 * are pinned per network. Changing either is a deliberate, reviewed change.
 *
 * Run with: npm test
 */
import { after, describe, it } from "node:test"
import assert from "node:assert/strict"

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"

type TokensModule = typeof import("./tokens.ts")

const originalChainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV

/**
 * CHAIN_ID is read once when the module loads, so each network gets its own
 * fresh copy of the module rather than sharing a cached one.
 */
async function tokensFor(chainEnv: string | undefined): Promise<TokensModule> {
  if (chainEnv === undefined) delete process.env.NEXT_PUBLIC_CHAIN_ENV
  else process.env.NEXT_PUBLIC_CHAIN_ENV = chainEnv
  return (await import(`./tokens.ts?chainEnv=${chainEnv ?? "unset"}`)) as TokensModule
}

/** The list should hold exactly one USDC entry, and return it. */
function usdcOf(module: TokensModule) {
  assert.equal(module.TRACKED_TOKENS.length, 1, "expected exactly one tracked token")
  const [token] = module.TRACKED_TOKENS
  assert.equal(token.symbol, "USDC")
  return token
}

after(() => {
  if (originalChainEnv === undefined) delete process.env.NEXT_PUBLIC_CHAIN_ENV
  else process.env.NEXT_PUBLIC_CHAIN_ENV = originalChainEnv
})

describe("TRACKED_TOKENS per network", () => {
  it("defaults to Base Sepolia USDC with six decimals", async () => {
    const token = usdcOf(await tokensFor(undefined))
    assert.equal(token.address, USDC_BASE_SEPOLIA)
    assert.equal(token.decimals, 6)
    assert.match(token.address, /^0x[0-9a-fA-F]{40}$/)
  })

  it("uses the Base USDC contract on mainnet with six decimals", async () => {
    const token = usdcOf(await tokensFor("mainnet"))
    assert.equal(token.address, USDC_BASE)
    assert.equal(token.decimals, 6)
    assert.match(token.address, /^0x[0-9a-fA-F]{40}$/)
  })

  it("treats an explicit testnet value as testnet", async () => {
    const token = usdcOf(await tokensFor("testnet"))
    assert.equal(token.address, USDC_BASE_SEPOLIA)
    assert.equal(token.decimals, 6)
  })

  it("does not switch networks on an unrecognised value", async () => {
    // Only "mainnet" moves real money; anything else must stay on testnet.
    const token = usdcOf(await tokensFor("staging"))
    assert.equal(token.address, USDC_BASE_SEPOLIA)
  })

  it("points at different contracts on the two networks", async () => {
    const mainnet = usdcOf(await tokensFor("mainnet"))
    const testnet = usdcOf(await tokensFor("testnet"))
    assert.notEqual(mainnet.address.toLowerCase(), testnet.address.toLowerCase())
    for (const token of [mainnet, testnet]) {
      assert.equal(token.decimals, 6)
      assert.equal(token.symbol, "USDC")
      assert.equal(token.name, "USD Coin")
    }
  })

  it("keeps the checksum casing so a mistyped address cannot pass as valid", async () => {
    for (const chainEnv of [undefined, "mainnet"]) {
      const token = usdcOf(await tokensFor(chainEnv))
      assert.notEqual(token.address, token.address.toLowerCase())
      assert.notEqual(token.address, token.address.toUpperCase())
    }
  })
})
