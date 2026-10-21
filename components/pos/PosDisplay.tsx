"use client"

import { useEffect, useState, useMemo } from "react"
import QRCode from "qrcode"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  type PosInvoice,
  formatCountdown,
  calculateProgress,
  buildPosPaymentUri,
  playPosChime,
} from "@/lib/pos"
import { stellarTransactionUrl } from "@/lib/stellar"
import { activeChain } from "@/lib/wagmi"
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  Copy,
  ExternalLink,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CreditCard,
  QrCode,
  DollarSign,
  Share2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface PosDisplayProps {
  invoice: PosInvoice
  onNewSale: () => void
  onSimulatePayment: (amount?: string) => void
  onUpdateInvoice: (updater: (prev: PosInvoice) => PosInvoice) => void
}

export function PosDisplay({
  invoice,
  onNewSale,
  onSimulatePayment,
  onUpdateInvoice,
}: PosDisplayProps) {
  const { toast } = useToast()
  const [qrDataUrl, setQrDataUrl] = useState<string>("")
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true)
  const [currentTime, setCurrentTime] = useState<number>(Date.now())

  // Update clock every second for live countdown
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setCurrentTime(now)

      // Auto flip to expired if past expiry and not paid
      if (
        invoice.status === "open" ||
        invoice.status === "partially_paid"
      ) {
        if (now >= invoice.expiresAt) {
          onUpdateInvoice((prev) => ({
            ...prev,
            status: "expired",
          }))
        }
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [invoice.expiresAt, invoice.status, onUpdateInvoice])

  // Generate QR code whenever invoice or remaining balance changes
  const activeQrUri = useMemo(() => {
    // If partially paid, generate QR for the outstanding balance
    if (invoice.status === "partially_paid" && Number(invoice.amountRemaining) > 0) {
      return buildPosPaymentUri({
        chain: invoice.chain,
        recipientAddress: invoice.recipientAddress,
        amount: invoice.amountRemaining,
        asset: invoice.asset,
        memo: invoice.memo,
        note: invoice.note,
      })
    }
    return invoice.uri
  }, [invoice])

  useEffect(() => {
    let isCancelled = false
    QRCode.toDataURL(activeQrUri, {
      margin: 1,
      width: 320,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!isCancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!isCancelled) setQrDataUrl("")
      })
    return () => {
      isCancelled = true
    }
  }, [activeQrUri])

  // Fullscreen kiosk toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true)
      }).catch(() => {})
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
      }).catch(() => {})
    }
  }

  // Copy URI or address
  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: `${label} copied` })
    } catch {
      toast({ title: `Could not copy ${label}`, variant: "destructive" })
    }
  }

  const countdown = formatCountdown(invoice.expiresAt, currentTime)
  const progressPct = calculateProgress(invoice.amountPaid, invoice.amount)

  // Explorer link for transactions
  const getTxExplorerUrl = (txHash: string) => {
    if (invoice.chain === "stellar") {
      return stellarTransactionUrl(txHash)
    }
    return `https://sepolia.basescan.org/tx/${txHash}`
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. PAID VIEW (Celebration / Counter Confirmation)
  // ─────────────────────────────────────────────────────────────────────────────
  if (invoice.status === "paid") {
    const latestTx = invoice.payments[invoice.payments.length - 1]

    return (
      <div className="relative mx-auto max-w-xl animate-in fade-in zoom-in-95 duration-300">
        <Card className="overflow-hidden border-2 border-emerald-500/40 bg-card/95 shadow-2xl backdrop-blur-md">
          {/* Top Emerald Header */}
          <div className="relative overflow-hidden bg-gradient-to-b from-emerald-500/20 to-transparent p-8 text-center">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xl shadow-emerald-500/30 animate-in zoom-in-50 duration-500">
              <CheckCircle2 className="h-14 w-14" />
            </div>

            <div className="mt-4 space-y-1">
              <span className="inline-block rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Payment Received
              </span>
              <h2 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">
                PAID IN FULL
              </h2>
            </div>

            <div className="mt-4 flex items-baseline justify-center gap-2">
              <span className="text-4xl font-extrabold tracking-tight tabular-nums text-foreground sm:text-5xl">
                {invoice.amountPaid}
              </span>
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {invoice.asset}
              </span>
            </div>

            {invoice.note && (
              <p className="mt-2 text-sm text-muted-foreground font-medium">
                Ref: {invoice.note}
              </p>
            )}
          </div>

          <CardContent className="space-y-6 p-6">
            {/* Transaction summary card */}
            <div className="space-y-3 rounded-2xl border border-border/80 bg-muted/30 p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Network</span>
                <span className="font-semibold text-foreground">
                  {invoice.chain === "stellar" ? "Stellar Testnet" : "Base Sepolia"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Settled At</span>
                <span className="font-mono text-foreground">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>
              {latestTx?.txHash && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Transaction Hash</span>
                  <a
                    href={getTxExplorerUrl(latestTx.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    <span>{latestTx.txHash.slice(0, 10)}...{latestTx.txHash.slice(-8)}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {/* List of payments if multi-payment was received */}
            {invoice.payments.length > 1 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Payment Breakdown ({invoice.payments.length} parts)
                </span>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {invoice.payments.map((p, idx) => (
                    <div
                      key={p.id || idx}
                      className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-2 text-xs"
                    >
                      <span className="font-mono text-muted-foreground">Part #{idx + 1}</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        +{p.amount} {p.asset}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Big Next Sale Action Button */}
            <Button
              type="button"
              onClick={onNewSale}
              className="h-14 w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold shadow-xl shadow-emerald-600/25 transition-all"
            >
              <ArrowRight className="mr-2 h-5 w-5" />
              Start Next Sale
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. EXPIRED VIEW
  // ─────────────────────────────────────────────────────────────────────────────
  if (invoice.status === "expired") {
    return (
      <div className="relative mx-auto max-w-md animate-in fade-in duration-200">
        <Card className="border-2 border-destructive/40 bg-card shadow-2xl">
          <CardContent className="space-y-6 p-8 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <AlertTriangle className="h-10 w-10" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                Payment Request Expired
              </h2>
              <p className="text-xs text-muted-foreground">
                The {invoice.amount} {invoice.asset} invoice was not settled within the designated time limit.
              </p>
            </div>

            {Number(invoice.amountPaid) > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                A partial payment of {invoice.amountPaid} {invoice.asset} was received before expiration.
              </div>
            )}

            <Button
              type="button"
              onClick={onNewSale}
              className="h-12 w-full text-base font-semibold"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Generate New Invoice
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. OPEN OR PARTIALLY PAID VIEW (Active Counter Screen)
  // ─────────────────────────────────────────────────────────────────────────────
  const isPartial = invoice.status === "partially_paid"

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* Top Counter Bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {isPartial ? (
            <Badge className="bg-amber-500 text-white hover:bg-amber-600 animate-pulse">
              Partially Paid ({progressPct.toFixed(0)}%)
            </Badge>
          ) : (
            <Badge className="bg-primary/20 text-primary border border-primary/40 animate-pulse">
              ● Awaiting Payment
            </Badge>
          )}

          <Badge variant="outline" className="font-mono text-xs">
            {invoice.chain === "stellar" ? "Stellar Testnet" : "Base Sepolia"}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {/* Sound toggle button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => {
              const next = !soundEnabled
              setSoundEnabled(next)
              if (next) playPosChime()
            }}
            title={soundEnabled ? "Chime enabled" : "Muted"}
          >
            {soundEnabled ? (
              <Volume2 className="h-4 w-4 text-primary" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </Button>

          {/* Fullscreen kiosk toggle */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={toggleFullscreen}
            title="Toggle Counter Kiosk Mode"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <Card className="glass-panel overflow-hidden border-2 border-border/80 shadow-2xl">
        <CardContent className="space-y-6 p-6 sm:p-8">
          {/* Amount Display */}
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {isPartial ? "Remaining Balance" : "Total to Pay"}
            </span>

            <div className="mt-1 flex items-baseline justify-center gap-2">
              <span className="text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl text-foreground">
                {isPartial ? invoice.amountRemaining : invoice.amount}
              </span>
              <span className="text-2xl font-bold text-primary">
                {invoice.asset}
              </span>
            </div>

            {invoice.note && (
              <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <span>Note:</span>
                <span className="font-medium text-foreground">{invoice.note}</span>
              </div>
            )}
          </div>

          {/* Partial payment progress bar if partially paid */}
          {isPartial && (
            <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-amber-800 dark:text-amber-300">
                  Received: {invoice.amountPaid} {invoice.asset}
                </span>
                <span className="text-amber-800 dark:text-amber-300">
                  Total: {invoice.amount} {invoice.asset}
                </span>
              </div>
              <Progress value={progressPct} className="h-2.5 bg-amber-200 dark:bg-amber-950" />
              <p className="text-[11px] text-muted-foreground text-center">
                QR code below updated for remaining {invoice.amountRemaining} {invoice.asset}.
              </p>
            </div>
          )}

          {/* QR Code Container */}
          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="relative rounded-3xl border-4 border-primary/20 bg-white p-3 shadow-2xl transition-transform hover:scale-[1.02]">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${invoice.amount} ${invoice.asset}`}
                  className="h-[260px] w-[260px] sm:h-[300px] sm:w-[300px] rounded-2xl"
                />
              ) : (
                <div className="flex h-[260px] w-[260px] items-center justify-center text-xs text-muted-foreground">
                  Generating high-contrast code...
                </div>
              )}
            </div>

            {/* Countdown timer */}
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-1.5 text-xs shadow-sm">
              <Clock
                className={cn(
                  "h-3.5 w-3.5",
                  countdown.minutes === 0 ? "text-destructive animate-spin" : "text-primary"
                )}
              />
              <span className="text-muted-foreground">Expires in:</span>
              <span
                className={cn(
                  "font-mono font-bold tabular-nums",
                  countdown.minutes === 0 ? "text-destructive" : "text-foreground"
                )}
              >
                {countdown.formatted}
              </span>
            </div>
          </div>

          {/* Address and quick actions */}
          <div className="flex flex-col items-center gap-2 text-xs">
            <div className="flex items-center gap-1 font-mono text-muted-foreground">
              <span>Merchant:</span>
              <button
                type="button"
                onClick={() => copyText(invoice.recipientAddress, "Merchant Address")}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-foreground hover:bg-muted transition-colors"
                title="Click to copy address"
              >
                <span>
                  {invoice.recipientAddress.slice(0, 10)}...{invoice.recipientAddress.slice(-8)}
                </span>
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Testnet simulation helper controls */}
          <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                Testnet / Demo Controls
              </span>
              <span className="text-[10px] text-muted-foreground">
                Trigger instant counter flip
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs font-medium border-primary/40 hover:bg-primary/10"
                onClick={() => onSimulatePayment(invoice.amountRemaining)}
              >
                Simulate Full Pay ({invoice.amountRemaining})
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs font-medium border-primary/40 hover:bg-primary/10"
                onClick={() => {
                  const half = (Number(invoice.amountRemaining) / 2).toFixed(2)
                  onSimulatePayment(half)
                }}
              >
                Simulate 50% Partial
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => copyText(activeQrUri, "Payment Link")}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Payment URI
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={onNewSale}
            >
              Cancel Sale
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
