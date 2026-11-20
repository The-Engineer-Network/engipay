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
import { Copy, Share2, ShieldCheck, Wallet, Loader2, AlertCircle } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { useStellarWallet } from "@/contexts/StellarWalletContext"
import { TRACKED_TOKENS } from "@/lib/tokens"
import { activeChain } from "@/lib/wagmi"
import { stellarNetwork } from "@/lib/stellar"
import { STELLAR_AMOUNT, buildPaymentUri, shortenAddress } from "@/lib/payment-uri"
import { NetworkTabs, networkPanelId, networkTabId } from "@/components/app/NetworkTabs"
import { cn } from "@/lib/utils"

const NATIVE = "native"

type DestinationChoice = "wallet" | "engipay"
type Network = "base" | "stellar" | "bitcoin"

interface DepositAddressResponse {
  chain: string
  address: string
  qr_uri: string
}

export default function ReceivePage() {
  const { evmAddress, stellarAddress, connectWallet } = useWallet()
  const { balances: stellarBalances } = useStellarWallet()
  const { toast } = useToast()

  const hasToken =
    typeof window !== "undefined" ? Boolean(localStorage.getItem("engipay-token")) : false

  const [destination, setDestination] = useState<DestinationChoice>(
    hasToken ? "engipay" : "wallet"
  )
  const [network, setNetwork] = useState<Network>(
    !evmAddress && stellarAddress ? "stellar" : "base"
  )
  const [amount, setAmount] = useState("")
  const [asset, setAsset] = useState<string>(NATIVE)
  const [qrDataUrl, setQrDataUrl] = useState("")

  // Custodial deposit address state
  const [depositAddress, setDepositAddress] = useState<DepositAddressResponse | null>(null)
  const [isLoadingDeposit, setIsLoadingDeposit] = useState(false)
  const [depositError, setDepositError] = useState<string | null>(null)

  // Fetch custodial deposit address when destination is 'engipay'
  useEffect(() => {
    if (destination !== "engipay") return

    const token =
      typeof window !== "undefined" ? localStorage.getItem("engipay-token") : null
    if (!token) {
      setDepositError("Please sign in to view your EngiPay deposit address.")
      return
    }

    let cancelled = false
    setIsLoadingDeposit(true)
    setDepositError(null)

    fetch(`/api/v1/deposit-address?chain=${network}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 503) {
          throw new Error(
            `${network === "stellar" ? "Stellar" : network === "base" ? "Base" : "Bitcoin"} deposit service is currently undergoing scheduled maintenance. Please check back shortly.`
          )
        }
        if (!res.ok) {
          throw new Error(`Failed to load deposit address (HTTP ${res.status})`)
        }
        return res.json() as Promise<DepositAddressResponse>
      })
      .then((data) => {
        if (!cancelled) {
          setDepositAddress(data)
          setIsLoadingDeposit(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDepositError(
            err instanceof Error ? err.message : "Failed to load deposit address"
          )
          setDepositAddress(null)
          setIsLoadingDeposit(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [destination, network])

  const address =
    destination === "engipay"
      ? depositAddress?.address ?? ""
      : network === "base"
      ? evmAddress
      : stellarAddress

  // Reset asset when switching network
  useEffect(() => setAsset(NATIVE), [network])

  const token = useMemo(
    () => (network === "base" ? TRACKED_TOKENS.find((t) => t.address === asset) : undefined),
    [asset, network]
  )

  const amountValid =
    amount === "" ||
    (Number(amount) > 0 && (network === "base" || STELLAR_AMOUNT.test(amount)))

  /** The code we show: for EngiPay custodial, exactly what API returned; for wallet, standard URI */
  const paymentUri = useMemo(() => {
    if (destination === "engipay") {
      return depositAddress?.qr_uri ?? ""
    }
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
  }, [address, amount, amountValid, asset, destination, depositAddress, network, token])

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

  const networkOptions = useMemo(() => {
    const list = [
      { value: "base" as Network, label: activeChain.name },
      { value: "stellar" as Network, label: stellarNetwork.label },
    ]
    if (destination === "engipay") {
      list.push({ value: "bitcoin" as Network, label: "Bitcoin" })
    }
    return list
  }, [destination])

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Receive"
        description="Show this code or copy your address to receive funds into your wallet or EngiPay balance."
      />

      <Card>
        <CardContent className="space-y-6 p-6">
          {/* Destination Selector: EngiPay Balance vs External Wallet */}
          <div className="flex items-center justify-center">
            <div className="inline-flex rounded-full border border-border bg-card/60 p-1 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={() => {
                  setDestination("engipay")
                }}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                  destination === "engipay"
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                My EngiPay Balance
              </button>
              <button
                type="button"
                onClick={() => {
                  setDestination("wallet")
                  if (network === "bitcoin") setNetwork("base")
                }}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                  destination === "wallet"
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Wallet className="h-3.5 w-3.5" />
                My Wallet
              </button>
            </div>
          </div>

          <NetworkTabs
            className={cn(
              "grid gap-1 rounded-full border border-border bg-background/60 p-1",
              destination === "engipay" ? "grid-cols-3" : "grid-cols-2"
            )}
            idPrefix="receive"
            value={network}
            onChange={(val) => setNetwork(val as Network)}
            options={networkOptions}
          />

          <div
            role="tabpanel"
            id={networkPanelId("receive", network)}
            aria-labelledby={networkTabId("receive", network)}
            className="flex flex-col items-center gap-4"
          >
            {destination === "engipay" && isLoadingDeposit ? (
              <div className="flex h-[280px] w-[280px] flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-6">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">Provisioning deposit address...</p>
              </div>
            ) : destination === "engipay" && depositError ? (
              <div className="flex h-[280px] w-[280px] flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-xs font-medium text-destructive">{depositError}</p>
              </div>
            ) : qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="QR code containing your payment details"
                className="h-[280px] w-[280px] rounded-lg bg-white p-2"
              />
            ) : (
              <div className="flex h-[280px] w-[280px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {network === "stellar"
                  ? "Connect a Stellar wallet to show your Stellar code"
                  : "Connect an EVM wallet to show your Base code"}
                <Button size="sm" variant="outline" className="rounded-full" onClick={connectWallet}>
                  Connect wallet
                </Button>
              </div>
            )}

            {address && (
              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => copy(address, "Address")}
                  className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {shortenAddress(address, 10, 8)}
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className="text-[11px] text-muted-foreground">Click address to copy full text</span>
              </div>
            )}
          </div>

          {destination === "wallet" && (
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
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => copy(paymentUri, destination === "engipay" ? "Deposit URI" : "Payment link")}
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

          {/* Stellar Muxed Address Notice */}
          {destination === "engipay" && network === "stellar" && (
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs leading-relaxed text-foreground">
              <strong>Notice:</strong> Your Stellar deposit address starts with <code>M...</code> (a multiplexed address). You must send directly to this exact <code>M...</code> address without changing or stripping the prefix so funds are instantly credited to your EngiPay balance.
            </div>
          )}

          {destination === "wallet" && network === "stellar" && stellarAddress && stellarBalances && !stellarBalances.funded && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              This Stellar account is new. Its first payment must be at least 1 XLM, which opens it
              on the network.
            </p>
          )}
          {destination === "wallet" && network === "stellar" && asset === "USDC" && stellarBalances?.funded && stellarBalances.usdc === null && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              Add USDC in Freighter before sharing this code. Until then, USDC payments to you fail.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {destination === "engipay"
              ? "Funds sent to this deposit address will automatically be credited to your custodial EngiPay balance once confirmed."
              : `This code follows the standard payment format, so any compatible wallet can pay it.`}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
