"use client"

import { useAccountModal } from "@rainbow-me/rainbowkit"
import { useBalance } from "wagmi"
import { formatUnits } from "viem"
import { Wallet } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { shortenAddress } from "@/lib/payment-uri"
import { cn } from "@/lib/utils"

interface ConnectWalletButtonProps {
  className?: string
  /** Show the native balance beside the address on wide screens. */
  showBalance?: boolean
}

/**
 * One button for both states. Disconnected, it opens our wallet sheet.
 * Connected, it shows the account and opens RainbowKit's account panel, which
 * handles copy, explorer links and disconnecting well already.
 */
export function ConnectWalletButton({ className, showBalance = true }: ConnectWalletButtonProps) {
  const { isConnected, walletAddress, connectWallet, isConnecting } = useWallet()
  const { openAccountModal } = useAccountModal()
  const { data: balance } = useBalance({
    address: walletAddress as `0x${string}` | undefined,
    query: { enabled: Boolean(walletAddress) },
  })

  if (!isConnected || !walletAddress) {
    return (
      <button
        type="button"
        onClick={connectWallet}
        disabled={isConnecting}
        className={cn(
          "glow-button inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70",
          className
        )}
      >
        <Wallet className="h-4 w-4" aria-hidden="true" />
        {isConnecting ? "Connecting…" : "Connect wallet"}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={openAccountModal}
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border border-border bg-card/80 py-1.5 pl-1.5 pr-4 text-sm transition-colors hover:border-primary/50",
        className
      )}
    >
      <span
        className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-[hsl(168_90%_45%)]"
        aria-hidden="true"
      />
      {showBalance && balance && (
        <span className="hidden tabular-nums text-muted-foreground sm:inline">
          {Number(formatUnits(balance.value, balance.decimals)).toFixed(4)} {balance.symbol}
        </span>
      )}
      <span className="font-mono font-medium">{shortenAddress(walletAddress, 5, 4)}</span>
    </button>
  )
}
