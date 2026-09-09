"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/contexts/WalletContext"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import { BalanceCard } from "@/components/dashboard/BalanceCard"
import { QuickActions } from "@/components/dashboard/QuickActions"
import { ActivityCard } from "@/components/dashboard/ActivityCard"
import { TabType } from "@/types/dashboard"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Copy, Wallet } from "lucide-react"
import dynamic from "next/dynamic"

const PanelSkeleton = () => (
  <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
)

const SendPayment = dynamic(
  () => import("@/components/payments/SendPayment").then((m) => ({ default: m.SendPayment })),
  { loading: PanelSkeleton }
)
const BtcSwap = dynamic(
  () => import("@/components/payments/BtcSwap").then((m) => ({ default: m.BtcSwap })),
  { loading: PanelSkeleton }
)
const ServicePurchase = dynamic(
  () => import("@/components/payments/ServicePurchase").then((m) => ({ default: m.ServicePurchase })),
  { loading: PanelSkeleton }
)

/** Balance values arrive as display strings like "$1,234.56". */
function parseUsd(value: string): number {
  const n = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""))
  return Number.isFinite(n) ? n : 0
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabType>("overview")
  const [openModal, setOpenModal] = useState<null | "send" | "receive" | "swap" | "merchant">(null)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const { toast } = useToast()
  const { isConnected, balances, isLoadingBalances, walletAddress } = useWallet()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const savedWallet = localStorage.getItem("engipay-wallet")
    if (!isConnected && !savedWallet) router.push("/")
  }, [mounted, isConnected, router])

  const totalValue = useMemo(
    () => balances.reduce((sum, asset) => sum + parseUsd(asset.value), 0),
    [balances]
  )

  if (!mounted) return null

  const handleQuickAction = (action: string) => {
    if (!isConnected) {
      toast({
        title: "Wallet not connected",
        description: "Connect your wallet to continue.",
        variant: "destructive",
      })
      return
    }

    const map: Record<string, typeof openModal> = {
      Send: "send",
      Receive: "receive",
      Swap: "swap",
      "Pay Merchant": "merchant",
    }
    setOpenModal(map[action] ?? null)
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    if (tab === "payments") router.push("/payments-swaps")
    else if (tab === "defi") router.push("/defi")
  }

  const copyAddress = async () => {
    if (!walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      toast({ title: "Address copied", description: "Your wallet address is on the clipboard." })
    } catch {
      toast({
        title: "Could not copy",
        description: "Copy the address manually instead.",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DashboardHeader />
      <DashboardNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="container py-8">
        {/* One clear headline figure, rather than repeating the total three times */}
        <header className="mb-8">
          <p className="text-sm text-muted-foreground">Total balance</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">
            {isLoadingBalances ? (
              <span className="inline-block h-10 w-40 animate-pulse rounded bg-muted align-middle" />
            ) : (
              `$${totalValue.toFixed(2)}`
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoadingBalances
              ? "Refreshing balances..."
              : `${balances.length} ${balances.length === 1 ? "asset" : "assets"}`}
          </p>
        </header>

        <QuickActions onAction={handleQuickAction} />

        <section className="mb-8" aria-labelledby="assets-heading">
          <h2 id="assets-heading" className="mb-4 text-lg font-semibold tracking-tight">
            Your assets
          </h2>

          {isLoadingBalances ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-36 animate-pulse rounded-lg border border-border bg-card" />
              ))}
            </div>
          ) : balances.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {balances.map((asset) => (
                <BalanceCard key={asset.symbol} {...asset} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <Wallet className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">No assets yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Tokens in your connected wallet will appear here.
              </p>
            </div>
          )}
        </section>

        <ActivityCard activities={[]} />
      </main>

      <Dialog open={openModal === "send"} onOpenChange={(o) => !o && setOpenModal(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send payment</DialogTitle>
          </DialogHeader>
          <SendPayment />
        </DialogContent>
      </Dialog>

      <Dialog open={openModal === "receive"} onOpenChange={(o) => !o && setOpenModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Receive payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Share this address to receive payments.
            </p>
            <p className="break-all rounded-md border border-border bg-muted p-3 font-mono text-xs">
              {walletAddress}
            </p>
            <Button onClick={copyAddress} className="w-full">
              <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
              Copy address
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={openModal === "swap"} onOpenChange={(o) => !o && setOpenModal(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cross-chain swap</DialogTitle>
          </DialogHeader>
          <BtcSwap />
        </DialogContent>
      </Dialog>

      <Dialog open={openModal === "merchant"} onOpenChange={(o) => !o && setOpenModal(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pay merchant</DialogTitle>
          </DialogHeader>
          <ServicePurchase />
        </DialogContent>
      </Dialog>
    </div>
  )
}
