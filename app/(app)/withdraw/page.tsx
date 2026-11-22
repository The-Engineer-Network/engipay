"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, AlertCircle, ArrowRight, ArrowLeft } from "lucide-react"
import { DISPLAY_ASSETS } from "@/lib/assets"
import { apiClient } from "@/lib/api-client"
import { cn } from "@/lib/utils"

type Step = "form" | "confirm"

interface WithdrawalForm {
  asset: string
  chain: string
  destination: string
  amount: string
}

export default function WithdrawPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("form")
  const [form, setForm] = useState<WithdrawalForm>({
    asset: "",
    chain: "",
    destination: "",
    amount: "",
  })
  const [feeEstimate, setFeeEstimate] = useState<string>("0")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Get sendable assets with their available chains
  const sendableAssets = DISPLAY_ASSETS.filter((a) => a.sendable)

  // Get available chains for selected asset
  const availableChains = sendableAssets.find((a) => a.symbol === form.asset)?.chains || []

  // Generate idempotency key
  const generateIdempotencyKey = () => {
    return `withdrawal-${Date.now()}-${Math.random().toString(36).substring(7)}`
  }

  // Validate destination address based on chain
  const validateDestination = (chain: string, address: string): string | null => {
    if (!address) return "Destination address is required"

    switch (chain) {
      case "stellar":
        // Stellar addresses are 56 chars and start with G
        if (!/^G[A-Z0-9]{55}$/.test(address)) {
          return "Invalid Stellar address format"
        }
        break
      case "base":
        // Ethereum/Base addresses are 42 chars and start with 0x
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          return "Invalid Base address format"
        }
        break
      case "bitcoin":
        // Bitcoin addresses can be various formats
        if (address.length < 26 || address.length > 90) {
          return "Invalid Bitcoin address format"
        }
        break
    }

    return null
  }

  // Estimate network fee (simplified - in real app this would call an API)
  const estimateNetworkFee = (asset: string, chain: string): string => {
    // Simplified fee estimation
    const feeMap: Record<string, Record<string, string>> = {
      stellar: { USDC: "0.00001", XLM: "0.00001" },
      base: { ETH: "0.0001", USDC: "0.0001" },
      bitcoin: { BTC: "0.00001" },
    }
    return feeMap[chain]?.[asset] || "0.0001"
  }

  const handleAssetChange = (asset: string) => {
    const chains = sendableAssets.find((a) => a.symbol === asset)?.chains || []
    setForm({
      ...form,
      asset,
      chain: chains[0] || "", // Auto-select first available chain
    })
    if (chains[0]) {
      setFeeEstimate(estimateNetworkFee(asset, chains[0]))
    }
  }

  const handleChainChange = (chain: string) => {
    setForm({ ...form, chain })
    if (form.asset) {
      setFeeEstimate(estimateNetworkFee(form.asset, chain))
    }
  }

  const handleContinue = () => {
    setError(null)

    // Validate form
    if (!form.asset) {
      setError("Please select an asset")
      return
    }
    if (!form.chain) {
      setError("Please select a network")
      return
    }
    if (!form.destination) {
      setError("Please enter a destination address")
      return
    }
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setError("Please enter a valid amount")
      return
    }

    // Validate destination address
    const destError = validateDestination(form.chain, form.destination)
    if (destError) {
      setError(destError)
      return
    }

    // Move to confirmation
    setStep("confirm")
  }

  const handleSubmit = async () => {
    setError(null)
    setIsSubmitting(true)

    try {
      const idempotencyKey = generateIdempotencyKey()

      const response = await apiClient.createWithdrawal({
        asset: form.asset,
        chain: form.chain,
        destination: form.destination,
        amount: parseFloat(form.amount),
        estimated_network_fee: parseFloat(feeEstimate),
        idempotency_key: idempotencyKey,
      })

      // Redirect to withdrawal status page
      router.push(`/withdraw/${response.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create withdrawal")
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Withdraw"
        description="Send crypto to an external wallet or address."
      />

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === "form" ? (
        <Card>
          <CardHeader>
            <CardTitle>Withdrawal Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Asset Selection */}
            <div className="space-y-2">
              <Label htmlFor="asset">Asset</Label>
              <Select value={form.asset} onValueChange={handleAssetChange}>
                <SelectTrigger id="asset">
                  <SelectValue placeholder="Select asset" />
                </SelectTrigger>
                <SelectContent>
                  {sendableAssets.map((asset) => (
                    <SelectItem key={asset.symbol} value={asset.symbol}>
                      {asset.symbol} - {asset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Network Selection */}
            {form.asset && availableChains.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="chain">Network</Label>
                <Select value={form.chain} onValueChange={handleChainChange}>
                  <SelectTrigger id="chain">
                    <SelectValue placeholder="Select network" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableChains.map((chain) => (
                      <SelectItem key={chain} value={chain}>
                        {chain.charAt(0).toUpperCase() + chain.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Destination Address */}
            <div className="space-y-2">
              <Label htmlFor="destination">Destination Address</Label>
              <Input
                id="destination"
                type="text"
                placeholder={
                  form.chain === "stellar"
                    ? "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    : form.chain === "base"
                    ? "0x..."
                    : "Enter address"
                }
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {form.chain === "stellar" && "Stellar address (starts with G)"}
                {form.chain === "base" && "Base/Ethereum address (starts with 0x)"}
                {form.chain === "bitcoin" && "Bitcoin address"}
              </p>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <div className="relative">
                <Input
                  id="amount"
                  type="number"
                  step="0.000001"
                  min="0"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="pr-16"
                />
                {form.asset && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {form.asset}
                  </span>
                )}
              </div>
            </div>

            {/* Fee Estimate */}
            {form.asset && form.chain && (
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Estimated network fee</span>
                  <span className="font-medium">
                    {feeEstimate} {form.asset}
                  </span>
                </div>
                <div className="mt-2 flex justify-between text-sm font-semibold">
                  <span>Total amount</span>
                  <span>
                    {(parseFloat(form.amount || "0") + parseFloat(feeEstimate)).toFixed(6)}{" "}
                    {form.asset}
                  </span>
                </div>
              </div>
            )}

            {/* Continue Button */}
            <Button onClick={handleContinue} className="w-full" size="lg">
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Confirm Withdrawal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Confirmation Details */}
            <div className="space-y-4 rounded-lg border border-border p-4">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Asset</span>
                <span className="font-medium">{form.asset}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Network</span>
                <span className="font-medium capitalize">{form.chain}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Destination</span>
                <span className="font-mono text-xs break-all">{form.destination}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Amount</span>
                <span className="font-medium">
                  {form.amount} {form.asset}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Network fee</span>
                <span className="font-medium">
                  {feeEstimate} {form.asset}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-4">
                <span className="font-semibold">Total</span>
                <span className="font-semibold">
                  {(parseFloat(form.amount) + parseFloat(feeEstimate)).toFixed(6)} {form.asset}
                </span>
              </div>
            </div>

            {/* Warning */}
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Please verify the destination address carefully. Cryptocurrency transactions cannot be
                reversed.
              </AlertDescription>
            </Alert>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep("form")}
                className="flex-1"
                disabled={isSubmitting}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                className="flex-1"
                disabled={isSubmitting}
                size="lg"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Confirm Withdrawal"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
