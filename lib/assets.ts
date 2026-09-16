import { TRACKED_TOKENS } from "@/lib/tokens"
import { activeChain } from "@/lib/wagmi"

export interface DisplayAsset {
  symbol: string
  name: string
  /** The networks this currency moves on. One balance, whichever it arrived on. */
  chains: ("base" | "bitcoin" | "stellar")[]
  /** False while the chain service that would move it does not exist yet. */
  sendable: boolean
}

/**
 * Every currency the product talks about, including the ones we cannot move
 * yet. Showing BTC as present but not yet sendable is more honest than hiding it.
 */
export const DISPLAY_ASSETS: DisplayAsset[] = [
  {
    symbol: activeChain.nativeCurrency.symbol,
    name: "Ether on Base",
    chains: ["base"],
    sendable: true,
  },
  ...TRACKED_TOKENS.map((token): DisplayAsset => {
    const alsoOnStellar = token.symbol === "USDC"
    return {
      symbol: token.symbol,
      name: alsoOnStellar ? `${token.name} on Base and Stellar` : `${token.name} on Base`,
      chains: alsoOnStellar ? ["base", "stellar"] : ["base"],
      sendable: true,
    }
  }),
  { symbol: "XLM", name: "Stellar Lumens", chains: ["stellar"], sendable: true },
  { symbol: "BTC", name: "Bitcoin", chains: ["bitcoin"], sendable: false },
]
