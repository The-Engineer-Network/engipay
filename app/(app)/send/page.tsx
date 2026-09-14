"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/app/PageHeader"
import { SendPayment } from "@/components/payments/SendPayment"
import { Card, CardContent } from "@/components/ui/card"
import { Bitcoin } from "lucide-react"

function SendForm() {
  const params = useSearchParams()
  const recipient = params.get("to") ?? ""
  const amount = params.get("amount") ?? ""
  const token = params.get("token") ?? ""

  return <SendPayment initialRecipient={recipient} initialAmount={amount} initialToken={token} />
}

export default function SendPage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Send"
        description="Send ETH or USDC on Base to any wallet address."
      />

      <Suspense fallback={<div className="h-80 animate-pulse rounded-lg border border-border bg-card" />}>
        <SendForm />
      </Suspense>

      <Card className="mt-6 border-dashed">
        <CardContent className="flex items-start gap-3 p-4">
          <Bitcoin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Bitcoin sending needs the chain service, which is not built yet. Until then this
            screen handles Base only.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
