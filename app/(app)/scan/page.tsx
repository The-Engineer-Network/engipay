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

    setParsed(result)

    // Base payments can go straight to the send form, prefilled.
    if (result.chain === "base") {
      const query = new URLSearchParams({ to: result.address })
      if (result.amount) query.set("amount", result.amount)
      router.push(`/send?${query.toString()}`)
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Scan to pay"
        description="Scan a payment code from EngiPay or any other wallet."
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
