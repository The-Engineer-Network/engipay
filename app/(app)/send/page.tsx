"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/app/PageHeader"
import { SendPayment } from "@/components/payments/SendPayment"
import { StellarSendPayment } from "@/components/payments/StellarSendPayment"
import { EngiPaySendPayment } from "@/components/payments/EngiPaySendPayment"
import { Card, CardContent } from "@/components/ui/card"
import { Bitcoin, ShieldCheck, Wallet } from "lucide-react"
import { activeChain } from "@/lib/wagmi"
import { stellarNetwork } from "@/lib/stellar"
import { NetworkTabs, networkPanelId, networkTabId } from "@/components/app/NetworkTabs"
import { useWallet } from "@/contexts/WalletContext"
import { cn } from "@/lib/utils"

type SourceType = "wallet" | "engipay"
type Network = "base" | "stellar"

function SendForm() {
  const params = useSearchParams()
  const { evmAddress, stellarAddress } = useWallet()

  const hasToken =
    typeof window !== "undefined" ? Boolean(localStorage.getItem("engipay-token")) : false

  const [source, setSource] = useState<SourceType>(hasToken ? "engipay" : "wallet")
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
      {/* Source Selector: EngiPay Balance vs External Wallet */}
      <div className="flex items-center justify-center">
        <div className="inline-flex rounded-full border border-border bg-card/60 p-1 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => setSource("engipay")}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
              source === "engipay"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            EngiPay Balance
          </button>
          <button
            type="button"
            onClick={() => setSource("wallet")}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
              source === "wallet"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Wallet className="h-3.5 w-3.5" />
            Connected Wallet
          </button>
        </div>
      </div>

      {source === "engipay" ? (
        <Card>
          <CardContent className="p-6">
            <EngiPaySendPayment
              initialRecipient={recipient}
              initialAmount={amount}
              initialAsset={params.get("asset") ?? "USDC"}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* The network decides what an address means, so it is chosen first. */}
          <NetworkTabs
            className="grid grid-cols-2 gap-1 rounded-full border border-border bg-card/60 p-1"
            idPrefix="send"
            value={network}
            onChange={setNetwork}
            options={[
              { value: "base", label: activeChain.name },
              { value: "stellar", label: stellarNetwork.label },
            ]}
          />

          <div role="tabpanel" id={networkPanelId("send", network)} aria-labelledby={networkTabId("send", network)}>
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
        </>
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

      <div className="mt-4 rounded-xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">Paying multiple recipients?</p>
            <p className="text-xs text-muted-foreground">
              Upload a CSV of recipients and amounts with built-in dual-approval and idempotency guarantees.
            </p>
          </div>
          <Link
            href="/batch"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            Batch CSV
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <Card className="mt-4 border-dashed">
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
