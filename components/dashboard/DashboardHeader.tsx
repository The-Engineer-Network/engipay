"use client"

import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Wallet, ExternalLink, Bitcoin, Copy, LogOut, ChevronDown } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { useToast } from "@/hooks/use-toast"
import { getBitcoinBalance } from "@/lib/xverse"

const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_STARKNET_EXPLORER || "https://sepolia.starkscan.co"

export function DashboardHeader() {
  const router = useRouter()
  const { toast } = useToast()
  const { walletAddress, walletName, disconnectWallet } = useWallet()
  const [btcBalance, setBtcBalance] = useState<number | null>(null)

  useEffect(() => {
    if (walletName !== "Xverse") {
      setBtcBalance(null)
      return
    }
    let cancelled = false
    getBitcoinBalance()
      .then((b) => {
        if (!cancelled) setBtcBalance(b.total / 100_000_000)
      })
      .catch((error) => console.error("Error loading BTC balance:", error))
    return () => {
      cancelled = true
    }
  }, [walletName])

  const handleDisconnect = () => {
    disconnectWallet()
    router.push("/")
  }

  const copyAddress = async () => {
    if (!walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      toast({ title: "Address copied" })
    } catch {
      toast({ title: "Could not copy address", variant: "destructive" })
    }
  }

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null

  return (
    <header className="border-b border-border">
      <div className="container flex items-center justify-between gap-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex shrink-0 items-center transition-opacity hover:opacity-80">
            <img
              src="/engipay.png"
              alt="EngiPay"
              className="h-8 w-8 object-contain brightness-0 invert"
            />
          </Link>

          {btcBalance !== null && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Bitcoin className="h-4 w-4 text-warning" aria-hidden="true" />
              <span className="tabular-nums">{btcBalance.toFixed(8)} BTC</span>
            </span>
          )}
        </div>

        {walletAddress ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* Previously a bare button labelled "Connect" that silently
                  disconnected the wallet on click. Now it opens a menu. */}
              <Button variant="outline" size="sm" className="gap-2">
                <Wallet className="h-4 w-4" aria-hidden="true" />
                <span className="hidden font-mono text-xs sm:inline">{shortAddress}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <span className="block text-xs text-muted-foreground">
                  {walletName ?? "Wallet"}
                </span>
                <span className="block truncate font-mono text-xs">{shortAddress}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={copyAddress}>
                <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                Copy address
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={`${EXPLORER_BASE}/contract/${walletAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                  View on explorer
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleDisconnect} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" onClick={() => router.push("/")}>
            <Wallet className="mr-2 h-4 w-4" aria-hidden="true" />
            Connect wallet
          </Button>
        )}
      </div>
    </header>
  )
}
