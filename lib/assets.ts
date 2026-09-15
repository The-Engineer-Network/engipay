import { TRACKED_TOKENS } from "@/lib/tokens"
import { activeChain } from "@/lib/wagmi"

export interface DisplayAsset {
  symbol: string
  name: string
  chain: "base" | "bitcoin"
  /** False while the chain service that would move it does not exist yet. */
  sendable: boolean
}

/**
 * Every asset the product talks about, including the ones we cannot move yet.
 * Showing BTC as present but not yet sendable is more honest than hiding it.
 */
export const DISPLAY_ASSETS: DisplayAsset[] = [
  {
    symbol: activeChain.nativeCurrency.symbol,
    name: "Ether on Base",
    chain: "base",
    sendable: true,
  },
  ...TRACKED_TOKENS.map((token) => ({
    symbol: token.symbol,
    name: `${token.name} on Base`,
    chain: "base" as const,
    sendable: true,
  })),
  { symbol: "BTC", name: "Bitcoin", chain: "bitcoin", sendable: false },
]
