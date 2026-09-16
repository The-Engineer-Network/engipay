"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "@/components/app/PageHeader"
import { QRScanner } from "@/components/payments/QRScanner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { AlertCircle, Bitcoin } from "lucide-react"
import { TRACKED_TOKENS } from "@/lib/tokens"
import { parsePaymentCode, shortenAddress, type ParsedPayment } from "@/lib/payment-uri"
import { stellarNetwork } from "@/lib/stellar"

/** Lets the parser turn token amounts into human numbers. */
function tokenDecimals(contract: string): number | undefined {
  const match = TRACKED_TOKENS.find(
    (token) => token.address.toLowerCase() === contract.toLowerCase()
  )
  return match?.decimals
}

export default function ScanPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [parsed, setParsed] = useState<ParsedPayment | null>(null)

  const handleScan = (text: string) => {
    const result = parsePaymentCode(text, tokenDecimals)

    if (!result) {
      toast({
        title: "Code not recognised",
        description: "That is not a wallet address or a payment code.",
        variant: "destructive",
      })
      return
    }

    // A code for another EVM network must never be paid on Base: the
    // recipient may not be watching Base at all.
    if (result.chain === "base" && !result.supportedNetwork) {
      toast({
        title: "Different network",
        description: `This code is for network ${result.chainId}. EngiPay sends on Base only, so it cannot be paid here.`,
        variant: "destructive",
      })
      return
    }

    setParsed(result)

    if (result.chain === "stellar") {
      // Only XLM, and USDC from Circle's own issuer, are paid. Anyone can issue
      // a token named USDC; paying it would send something worth nothing.
      const isXlm = result.asset === undefined || (result.asset === "XLM" && !result.assetIssuer)
      const isRealUsdc = result.asset === "USDC" && result.assetIssuer === stellarNetwork.usdcIssuer
      if (!isXlm && !isRealUsdc) {
        toast({
          title: "Asset not supported",
          description:
            result.asset === "USDC"
              ? `This asks for USDC from an issuer that is not Circle's on ${stellarNetwork.label}.`
              : `EngiPay sends XLM and USDC on Stellar, not ${result.asset}.`,
          variant: "destructive",
        })
        return
      }

      const query = new URLSearchParams({ network: "stellar", to: result.address })
      if (result.amount) query.set("amount", result.amount)
      query.set("asset", isRealUsdc ? "USDC" : "XLM")
      if (result.memo) {
        query.set("memo", result.memo.value)
        query.set("memo_type", result.memo.type)
      }
      router.push(`/send?${query.toString()}`)
      return
    }

    // Base payments can go straight to the send form, prefilled.
    if (result.chain === "base") {
      // A token request must open Send on that token. Otherwise "25 USDC"
      // would open as "25 ETH", and the amount would mean the wrong asset.
      if (result.tokenAddress && tokenDecimals(result.tokenAddress) === undefined) {
        toast({
          title: "Token not supported",
          description: "This code asks for a token EngiPay cannot send yet.",
          variant: "destructive",
        })
        return
      }

      const query = new URLSearchParams({ to: result.address })
      if (result.amount) query.set("amount", result.amount)
      if (result.tokenAddress) query.set("token", result.tokenAddress)
      router.push(`/send?${query.toString()}`)
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Scan to pay"
        description="Scan a payment code from EngiPay or any other wallet, on Base or Stellar."
      />

      <Card>
        <CardContent className="p-6">
          <QRScanner onScan={handleScan} />
        </CardContent>
      </Card>

      {parsed?.chain === "bitcoin" && (
        <Card className="mt-6 border-dashed">
          <CardContent className="space-y-3 p-4">
            <p className="flex items-start gap-2 text-sm font-medium">
              <Bitcoin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Bitcoin payment code
            </p>
            <dl className="space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between gap-4">
                <dt>To</dt>
                <dd className="font-mono">{shortenAddress(parsed.address, 10, 8)}</dd>
              </div>
              {parsed.amount && (
                <div className="flex justify-between gap-4">
                  <dt>Amount</dt>
                  <dd className="tabular-nums">{parsed.amount} BTC</dd>
                </div>
              )}
            </dl>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Bitcoin sending needs the chain service, which is not built yet. The code was read
              correctly, but it cannot be paid from here.
            </p>
            <Button variant="outline" size="sm" onClick={() => setParsed(null)}>
              Scan another
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
