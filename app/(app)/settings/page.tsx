"use client"

import { PageHeader } from "@/components/app/PageHeader"
import { PendingServiceNote } from "@/components/app/PendingServiceNote"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Copy } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { useStellarWallet } from "@/contexts/StellarWalletContext"
import { stellarNetwork } from "@/lib/stellar"
import { activeChain } from "@/lib/wagmi"
import { shortenAddress } from "@/lib/payment-uri"

export default function SettingsPage() {
  const { evmAddress: walletAddress, walletName, disconnectWallet, connectWallet } = useWallet()
  const { stellarAddress, networkMismatch, disconnectStellar } = useStellarWallet()
  const { toast } = useToast()

  const copyAddress = async (address: string | null = walletAddress) => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      toast({ title: "Address copied" })
    } catch {
      toast({ title: "Could not copy the address", variant: "destructive" })
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Connected with</span>
            <span className="text-sm font-medium">{walletAddress ? walletName ?? "—" : "—"}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Address</span>
            {walletAddress ? (
              <button
                type="button"
                onClick={() => copyAddress()}
                className="flex items-center gap-2 font-mono text-sm transition-colors hover:text-primary"
              >
                {shortenAddress(walletAddress, 8, 6)}
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <span className="text-sm">—</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Network</span>
            <span className="text-sm font-medium">{activeChain.name}</span>
          </div>

          <Button variant="outline" className="w-full" onClick={disconnectWallet}>
            Disconnect wallet
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stellar wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Address</span>
            {stellarAddress ? (
              <button
                type="button"
                onClick={() => copyAddress(stellarAddress)}
                className="flex items-center gap-2 font-mono text-sm transition-colors hover:text-primary"
              >
                {shortenAddress(stellarAddress, 8, 6)}
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <span className="text-sm">Not connected</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Network</span>
            <span className="text-sm font-medium">{stellarNetwork.label}</span>
          </div>

          {networkMismatch && <p className="text-sm text-warning">{networkMismatch}</p>}

          {stellarAddress ? (
            <Button variant="outline" className="w-full" onClick={disconnectStellar}>
              Disconnect Freighter
            </Button>
          ) : (
            <Button variant="outline" className="w-full" onClick={connectWallet}>
              Connect Freighter
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PendingServiceNote>
            Your profile, identity check and payout bank account live on the backend, which is not
            built yet. They appear here once it is connected.
          </PendingServiceNote>
        </CardContent>
      </Card>
    </div>
  )
}
