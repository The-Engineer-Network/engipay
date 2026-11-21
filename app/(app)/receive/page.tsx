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
import { ApiError, getDepositAddresses, type DepositAddress } from "@/lib/api-client"

const NATIVE = "native"

type DestinationChoice = "wallet" | "engipay"
type Network = "base" | "stellar" | "bitcoin"

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
  const [depositAddress, setDepositAddress] = useState<DepositAddress | null>(null)
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

    getDepositAddresses(network)
      .then((data) => {
        if (!cancelled) {
          setDepositAddress(data)
          setIsLoadingDeposit(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 503) {
            setDepositError(
              `${network === "stellar" ? "Stellar" : network === "base" ? "Base" : "Bitcoin"} deposit service is currently undergoing scheduled maintenance. Please check back shortly.`
            )
          } else {
            setDepositError(
              err instanceof Error ? err.message : "Failed to load deposit address"
            )
          }
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
                External Wallet
              </button>
            </div>
          </div>

          <NetworkTabs
            options={networkOptions}
            value={network}
            onChange={(value) => setNetwork(value as Network)}
            tabId={networkTabId}
            panelId={networkPanelId}
          />

          <div id={networkPanelId} role="tabpanel" aria-labelledby={networkTabId}>
            {destination === "engipay" && isLoadingDeposit && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading deposit address…
              </div>
            )}

            {destination === "engipay" && !isLoadingDeposit && depositError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{depositError}</span>
              </div>
            )}

            {destination === "wallet" && !address && (
              <div className="space-y-3 py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Connect a wallet to show your receive address.
                </p>
                <Button onClick={() => connectWallet()}>Connect wallet</Button>
              </div>
            )}

            {address && (
              <div className="space-y-4">
                {qrDataUrl && (
                  <div className="flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrDataUrl}
                      alt="Receive QR code"
                      className="h-[280px] w-[280px] rounded-lg bg-white p-2"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Address</Label>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={shortenAddress(address)} />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copy(address, "Address")}
                      aria-label="Copy address"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {destination === "wallet" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount (optional)</Label>
                      <Input
                        id="amount"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Asset</Label>
                      <Select value={asset} onValueChange={setAsset}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NATIVE}>Native</SelectItem>
                          {network === "base" &&
                            TRACKED_TOKENS.map((t) => (
                              <SelectItem key={t.address} value={t.address}>
                                {t.symbol}
                              </SelectItem>
                            ))}
                          {network === "stellar" && (
                            <SelectItem value="USDC">USDC</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => copy(paymentUri, "Payment link")}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy link
                  </Button>
                  <Button className="flex-1" onClick={share}>
                    <Share2 className="mr-2 h-4 w-4" />
                    Share
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
