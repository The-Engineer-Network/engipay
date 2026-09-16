"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/app/PageHeader"
import { SendPayment } from "@/components/payments/SendPayment"
import { StellarSendPayment } from "@/components/payments/StellarSendPayment"
import { Card, CardContent } from "@/components/ui/card"
import { Bitcoin } from "lucide-react"
import { activeChain } from "@/lib/wagmi"
import { stellarNetwork } from "@/lib/stellar"
import { cn } from "@/lib/utils"
import { useWallet } from "@/contexts/WalletContext"

type Network = "base" | "stellar"

function SendForm() {
  const params = useSearchParams()
  const { evmAddress, stellarAddress } = useWallet()
  // Open on the network the request names, else the one the user connected.
  const [network, setNetwork] = useState<Network>(
    params.get("network") === "stellar" || (!params.get("network") && !evmAddress && stellarAddress)
      ? "stellar"
      : "base"
  )
  const recipient = params.get("to") ?? ""
  const amount = params.get("amount") ?? ""
  const memo = params.get("memo")

  return (
    <div className="space-y-4">
      {/* The network decides what an address means, so it is chosen first. */}
      <div className="grid grid-cols-2 gap-1 rounded-full border border-border bg-card/60 p-1" role="tablist">
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

      {network === "base" ? (
        <SendPayment
          initialRecipient={params.get("network") === "stellar" ? "" : recipient}
          initialAmount={params.get("network") === "stellar" ? "" : amount}
          initialToken={params.get("token") ?? ""}
        />
      ) : (
        <StellarSendPayment
          initialRecipient={params.get("network") === "stellar" ? recipient : ""}
          initialAmount={params.get("network") === "stellar" ? amount : ""}
          initialAsset={params.get("asset") ?? "XLM"}
          initialMemo={
            memo ? { type: params.get("memo_type") === "id" ? "id" : "text", value: memo } : undefined
          }
        />
      )}
    </div>
  )
}

export default function SendPage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Send"
        description="Send ETH or USDC on Base, or XLM or USDC on Stellar, to any wallet address."
      />

      <Suspense fallback={<div className="h-80 animate-pulse rounded-lg border border-border bg-card" />}>
        <SendForm />
      </Suspense>

      <Card className="mt-6 border-dashed">
        <CardContent className="flex items-start gap-3 p-4">
          <Bitcoin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Bitcoin sending needs the chain service&apos;s Bitcoin client, which is not built yet.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
