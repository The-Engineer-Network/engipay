"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
import { Badge } from "@/components/ui/badge"
import { useWallet } from "@/contexts/WalletContext"
import { useStellarWallet } from "@/contexts/StellarWalletContext"
import { activeChain } from "@/lib/wagmi"
import { stellarNetwork } from "@/lib/stellar"
import {
  type PosInvoice,
  type PosChain,
  buildPosPaymentUri,
  getAssetDecimals,
} from "@/lib/pos"
import { createPaymentRequest } from "@/lib/api-client"
import {
  Wallet,
  ShieldCheck,
  QrCode,
  DollarSign,
  Delete,
  Sparkles,
  Clock,
  Layers,
  FileText,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface PosInvoiceFormProps {
  onCreateInvoice: (invoice: PosInvoice) => void
}

type DestinationType = "wallet" | "engipay"

const PRESET_AMOUNTS = ["1", "5", "10", "20", "50", "100"]

export function PosInvoiceForm({ onCreateInvoice }: PosInvoiceFormProps) {
  const { evmAddress, stellarAddress, connectWallet } = useWallet()
  const { balances: stellarBalances } = useStellarWallet()

  const hasEngipayToken =
    typeof window !== "undefined"
      ? Boolean(localStorage.getItem("engipay-token"))
      : false

  const [destination, setDestination] = useState<DestinationType>(
    hasEngipayToken ? "engipay" : "wallet"
  )
  const [chain, setChain] = useState<PosChain>(
    !evmAddress && stellarAddress ? "stellar" : "stellar"
  )
  const [asset, setAsset] = useState<string>("USDC")
  const [amount, setAmount] = useState<string>("")
  const [note, setNote] = useState<string>("")
  const [expiryMinutes, setExpiryMinutes] = useState<number>(15)
  const [allowPartial, setAllowPartial] = useState<boolean>(true)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Determine active receiving address
  const activeAddress = useMemo(() => {
    if (destination === "wallet") {
      return chain === "stellar" ? stellarAddress : evmAddress
    }
    // For EngiPay account, fallback to connected address if backend deposit endpoint isn't wired
    return chain === "stellar" ? stellarAddress : evmAddress
  }, [destination, chain, stellarAddress, evmAddress])

  // Asset choices based on chain
  const assetOptions = useMemo(() => {
    if (chain === "stellar") {
      return [
        { symbol: "USDC", name: "USD Coin (Circle)", icon: "💵" },
        { symbol: "XLM", name: "Stellar Lumens", icon: "✨" },
      ]
    }
    return [
      { symbol: "USDC", name: "USD Coin (Base)", icon: "💵" },
      { symbol: "ETH", name: "Ether (Base Sepolia)", icon: "🔷" },
    ]
  }, [chain])

  // Switch asset if current selection doesn't exist on new chain
  const handleChainChange = (newChain: PosChain) => {
    setChain(newChain)
    if (newChain === "stellar" && asset === "ETH") {
      setAsset("USDC")
    }
  }

  // Keypad actions
  const handleKeypadPress = (val: string) => {
    setErrorMessage(null)
    if (val === "C") {
      setAmount("")
      return
    }
    if (val === "BACK") {
      setAmount((prev) => prev.slice(0, -1))
      return
    }
    if (val === ".") {
      if (amount.includes(".")) return
      setAmount((prev) => (prev ? `${prev}.` : "0."))
      return
    }
    if (amount === "0") {
      setAmount(val)
      return
    }
    // Limit to 2 decimals for USDC, 4 for XLM/ETH
    const parts = amount.split(".")
    const maxDecimals = asset === "USDC" ? 2 : 4
    if (parts[1] && parts[1].length >= maxDecimals) return

    setAmount((prev) => `${prev}${val}`)
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setErrorMessage(null)

    const num = Number(amount)
    if (!amount || isNaN(num) || num <= 0) {
      setErrorMessage("Please enter an amount greater than 0.")
      return
    }

    if (!activeAddress) {
      setErrorMessage(
        chain === "stellar"
          ? "Please connect a Stellar wallet (Freighter) or sign in to receive."
          : "Please connect an EVM wallet (MetaMask/Coinbase) or sign in to receive."
      )
      return
    }

    setIsSubmitting(true)

    try {
      let apiRequestId: string | undefined
      const nowMs = Date.now()
      const expiresAtMs = nowMs + expiryMinutes * 60 * 1000

      // If user has an EngiPay session token, create a persistent payment request on backend
      if (hasEngipayToken) {
        try {
          const req = await createPaymentRequest({
            asset: asset.toUpperCase(),
            amount: amount.trim(),
            note: note.trim() || undefined,
            expiry_minutes: expiryMinutes,
            allow_partial: allowPartial,
          })
          if (req?.id) {
            apiRequestId = req.id
          }
        } catch {
          // If backend request fails (e.g. offline dev or unconfigured DB), gracefully fall back to direct on-chain POS invoice
        }
      }

      const invoiceId = apiRequestId || `inv_${nowMs}_${Math.random().toString(36).slice(2, 7)}`

      const uri = buildPosPaymentUri({
        chain,
        recipientAddress: activeAddress,
        amount: amount.trim(),
        asset,
        note: note.trim() || undefined,
      })

      const invoice: PosInvoice = {
        id: invoiceId,
        apiRequestId,
        amount: amount.trim(),
        asset,
        chain,
        recipientAddress: activeAddress,
        note: note.trim() || undefined,
        allowPartial,
        createdAt: nowMs,
        expiresAt: expiresAtMs,
        status: "open",
        amountPaid: "0",
        amountRemaining: amount.trim(),
        payments: [],
        uri,
      }

      onCreateInvoice(invoice)
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create payment invoice"
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="glass-panel border-border shadow-xl">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <QrCode className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-xl font-bold tracking-tight">
                New Charge / Bill
              </CardTitle>
              <CardDescription className="text-xs">
                Create a real-time QR payment request for your shop counter
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            {chain === "stellar" ? "Stellar Testnet" : "Base Sepolia"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Destination Switcher */}
        <div className="flex items-center justify-center">
          <div className="inline-flex rounded-full border border-border bg-card/70 p-1 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => setDestination("wallet")}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                destination === "wallet"
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Wallet className="h-3.5 w-3.5" />
              Direct Merchant Wallet
            </button>
            <button
              type="button"
              onClick={() => setDestination("engipay")}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                destination === "engipay"
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              EngiPay Account
            </button>
          </div>
        </div>

        {/* Chain and Asset Selector */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Network</Label>
            <Select
              value={chain}
              onValueChange={(val) => handleChainChange(val as PosChain)}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stellar">
                  <span className="flex items-center gap-2">
                    <span>✨</span>
                    <span>Stellar Testnet</span>
                  </span>
                </SelectItem>
                <SelectItem value="base">
                  <span className="flex items-center gap-2">
                    <span>🔷</span>
                    <span>Base Sepolia</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Asset to Receive</Label>
            <Select value={asset} onValueChange={setAsset}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assetOptions.map((opt) => (
                  <SelectItem key={opt.symbol} value={opt.symbol}>
                    <span className="flex items-center gap-2">
                      <span>{opt.icon}</span>
                      <span>{opt.symbol}</span>
                      <span className="text-xs text-muted-foreground">({opt.name})</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Big Amount Display */}
        <div className="rounded-2xl border border-border bg-card/60 p-4 text-center shadow-inner">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Charge Amount
          </span>
          <div className="mt-1 flex items-baseline justify-center gap-2">
            <span className="text-4xl font-extrabold tracking-tight tabular-nums text-foreground">
              {amount || "0.00"}
            </span>
            <span className="text-lg font-bold text-primary">{asset}</span>
          </div>
        </div>

        {/* Preset Amount Buttons */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Quick amounts</span>
            <span className="text-[11px]">Click to set</span>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {PRESET_AMOUNTS.map((val) => (
              <Button
                key={val}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(val)}
                className={cn(
                  "h-9 font-semibold transition-all hover:border-primary",
                  amount === val && "border-primary bg-primary/10 text-primary"
                )}
              >
                ${val}
              </Button>
            ))}
          </div>
        </div>

        {/* Numeric Keypad for Counter Tablet */}
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((k) => (
            <Button
              key={k}
              type="button"
              variant="outline"
              onClick={() => handleKeypadPress(k)}
              className="h-12 text-lg font-bold transition-all active:scale-95"
            >
              {k}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => handleKeypadPress("BACK")}
            className="h-12 font-bold text-destructive hover:bg-destructive/10"
            aria-label="Backspace"
          >
            <Delete className="h-5 w-5" />
          </Button>
        </div>

        {/* Invoice Metadata (Note, Expiry, Partial) */}
        <div className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pos-note" className="text-xs font-medium flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Order / Reference (Optional)
              </Label>
              <Input
                id="pos-note"
                placeholder="e.g. Table 4, #1089"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="pos-expiry" className="text-xs font-medium flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Validity
              </Label>
              <Select
                value={String(expiryMinutes)}
                onValueChange={(val) => setExpiryMinutes(Number(val))}
              >
                <SelectTrigger id="pos-expiry" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 Minutes</SelectItem>
                  <SelectItem value="15">15 Minutes</SelectItem>
                  <SelectItem value="30">30 Minutes</SelectItem>
                  <SelectItem value="60">1 Hour</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Accept Partial Payments</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={allowPartial}
              onClick={() => setAllowPartial(!allowPartial)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                allowPartial ? "bg-primary" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out",
                  allowPartial ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>
        </div>

        {/* Address status indicator */}
        {!activeAddress ? (
          <div className="flex items-center justify-between rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
            <div className="flex items-center gap-2 text-warning-foreground">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
              <span>No {chain === "stellar" ? "Stellar" : "EVM"} wallet connected.</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full text-xs"
              onClick={connectWallet}
            >
              Connect
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Receiving into:</span>
            <span className="font-mono font-medium text-foreground">
              {activeAddress.slice(0, 8)}...{activeAddress.slice(-6)}
            </span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Action Button */}
        <Button
          type="button"
          onClick={() => handleSubmit()}
          disabled={isSubmitting || !amount || Number(amount) <= 0 || !activeAddress}
          className="h-12 w-full text-base font-bold shadow-lg shadow-primary/25 transition-all"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Creating QR Code...
            </>
          ) : (
            <>
              <QrCode className="mr-2 h-5 w-5" />
              Charge {amount ? `${amount} ${asset}` : "Amount"}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
