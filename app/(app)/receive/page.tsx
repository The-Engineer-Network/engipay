"use client"

import { useEffect, useMemo, useState } from "react"
import { useAccount } from "wagmi"
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
import { TRACKED_TOKENS } from "@/lib/tokens"
import { activeChain } from "@/lib/wagmi"
import { buildPaymentUri, shortenAddress } from "@/lib/payment-uri"

const NATIVE = "native"

export default function ReceivePage() {
  const { address } = useAccount()
  const { toast } = useToast()

  const [amount, setAmount] = useState("")
  const [asset, setAsset] = useState<string>(NATIVE)
  const [qrDataUrl, setQrDataUrl] = useState("")

  const token = useMemo(
    () => TRACKED_TOKENS.find((t) => t.address === asset),
    [asset]
  )

  const amountValid = amount === "" || Number(amount) > 0

  /** The code we show: a standard URI, so any wallet can read it. */
  const paymentUri = useMemo(() => {
    if (!address) return ""
    return buildPaymentUri({
      chain: "base",
      address,
      amount: amountValid && amount ? amount : undefined,
      tokenAddress: token?.address,
      tokenDecimals: token?.decimals,
      chainId: activeChain.id,
    })
  }, [address, amount, amountValid, token])

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

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Receive"
        description="Show this code to get paid. Add an amount if you want to request a specific sum."
      />

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col items-center gap-4">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR code containing your payment details"
                className="h-[280px] w-[280px] rounded-lg bg-white p-2"
              />
            ) : (
              <div className="flex h-[280px] w-[280px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                Connect a wallet to show your code
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
                  <SelectItem value={NATIVE}>{activeChain.nativeCurrency.symbol}</SelectItem>
                  {TRACKED_TOKENS.map((t) => (
                    <SelectItem key={t.address} value={t.address}>
                      {t.symbol}
                    </SelectItem>
                  ))}
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
                onChange={(event) => setAmount(event.target.value)}
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

          <p className="text-xs text-muted-foreground">
            This code follows the standard payment format, so it works in other wallets too, not
            only EngiPay. It receives on {activeChain.name}.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
