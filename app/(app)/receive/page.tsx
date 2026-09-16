"use client"

import { useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"
import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Copy, Share2 } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { useStellarWallet } from "@/contexts/StellarWalletContext"
import { TRACKED_TOKENS } from "@/lib/tokens"
import { activeChain } from "@/lib/wagmi"
import { stellarNetwork } from "@/lib/stellar"
import { STELLAR_AMOUNT, buildPaymentUri, shortenAddress } from "@/lib/payment-uri"
import { cn } from "@/lib/utils"

const NATIVE = "native"

type Network = "base" | "stellar"

export default function ReceivePage() {
  const { evmAddress, stellarAddress, connectWallet } = useWallet()
  const { balances: stellarBalances } = useStellarWallet()
  const { toast } = useToast()

  const [network, setNetwork] = useState<Network>(!evmAddress && stellarAddress ? "stellar" : "base")
  const [amount, setAmount] = useState("")
  const [asset, setAsset] = useState<string>(NATIVE)
  const [qrDataUrl, setQrDataUrl] = useState("")

  const address = network === "base" ? evmAddress : stellarAddress

  // Each network has its own asset list; reset when switching.
  useEffect(() => setAsset(NATIVE), [network])

  const token = useMemo(
    () => (network === "base" ? TRACKED_TOKENS.find((t) => t.address === asset) : undefined),
    [asset, network]
  )

  const amountValid =
    amount === "" ||
    (Number(amount) > 0 && (network === "base" || STELLAR_AMOUNT.test(amount)))

  /** The code we show: a standard URI, so any wallet on that network can read it. */
  const paymentUri = useMemo(() => {
    if (!address) return ""
    const requested = amountValid && amount ? amount : undefined
    if (network === "stellar") {
      return buildPaymentUri({
        chain: "stellar",
        address,
        amount: requested,
        asset: asset === "USDC" ? "USDC" : "XLM",
        assetIssuer: asset === "USDC" ? stellarNetwork.usdcIssuer : undefined,
      })
    }
    return buildPaymentUri({
      chain: "base",
      address,
      amount: requested,
      tokenAddress: token?.address,
      tokenDecimals: token?.decimals,
      chainId: activeChain.id,
    })
  }, [address, amount, amountValid, asset, network, token])

  useEffect(() => {
    if (!paymentUri) {
      setQrDataUrl("")
      return
    }
    let cancelled = false
    QRCode.toDataURL(paymentUri, { margin: 1, width: 280 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("")
      })
    return () => {
      cancelled = true
    }
  }, [paymentUri])

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast({ title: `${label} copied` })
    } catch {
      toast({ title: `Could not copy the ${label.toLowerCase()}`, variant: "destructive" })
    }
  }

  const share = async () => {
    if (!navigator.share) {
      copy(paymentUri, "Payment link")
      return
    }
    try {
      await navigator.share({ title: "EngiPay request", text: paymentUri })
    } catch {
      // The user dismissed the share sheet.
    }
  }

  const networkLabel = network === "base" ? activeChain.name : stellarNetwork.label

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Receive"
        description="Show this code to get paid. Add an amount if you want to request a specific sum."
      />

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-1 rounded-full border border-border bg-background/60 p-1" role="tablist">
            {(
              [
                { value: "base", label: activeChain.name },
                { value: "stellar", label: stellarNetwork.label },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={network === option.value}
                onClick={() => setNetwork(option.value)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  network === option.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col items-center gap-4">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="QR code containing your payment details"
                className="h-[280px] w-[280px] rounded-lg bg-white p-2"
              />
            ) : (
              <div className="flex h-[280px] w-[280px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {network === "stellar"
                  ? "Connect Freighter to show your Stellar code"
                  : "Connect an EVM wallet to show your Base code"}
                <Button size="sm" variant="outline" className="rounded-full" onClick={connectWallet}>
                  Connect wallet
                </Button>
              </div>
            )}

            {address && (
              <button
                type="button"
                onClick={() => copy(address, "Address")}
                className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {shortenAddress(address, 10, 8)}
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="receive-asset">Asset</Label>
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger id="receive-asset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {network === "base" ? (
                    <>
                      <SelectItem value={NATIVE}>{activeChain.nativeCurrency.symbol}</SelectItem>
                      {TRACKED_TOKENS.map((t) => (
                        <SelectItem key={t.address} value={t.address}>
                          {t.symbol}
                        </SelectItem>
                      ))}
                    </>
                  ) : (
                    <>
                      <SelectItem value={NATIVE}>XLM</SelectItem>
                      <SelectItem value="USDC">USDC</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receive-amount">Amount (optional)</Label>
              <Input
                id="receive-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value.trim())}
                aria-invalid={!amountValid}
              />
              {!amountValid && (
                <p className="text-xs text-destructive">Enter an amount greater than zero.</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => copy(paymentUri, "Payment link")}
              disabled={!paymentUri}
            >
              <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
              Copy link
            </Button>
            <Button type="button" className="flex-1" onClick={share} disabled={!paymentUri}>
              <Share2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Share
            </Button>
          </div>

          {network === "stellar" && stellarAddress && stellarBalances && !stellarBalances.funded && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              This Stellar account is new. Its first payment must be at least 1 XLM, which opens it
              on the network.
            </p>
          )}
          {network === "stellar" && asset === "USDC" && stellarBalances?.funded && stellarBalances.usdc === null && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              Add USDC in Freighter before sharing this code. Until then, USDC payments to you fail.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            This code follows the standard payment format for {networkLabel}, so other wallets can
            pay it too, not only EngiPay.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
