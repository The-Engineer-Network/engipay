"use client"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { EngiPayTransaction } from "@/hooks/use-engipay-transactions"
import { ArrowUpRight, ArrowDownLeft, ExternalLink, Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"

interface TransactionDetailsSheetProps {
  transaction: EngiPayTransaction
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TransactionDetailsSheet({
  transaction,
  open,
  onOpenChange,
}: TransactionDetailsSheetProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  const getExplorerUrl = (txHash: string, asset: string) => {
    // Map assets to their respective block explorers
    const explorerMap: Record<string, string> = {
      ETH: `https://etherscan.io/tx/${txHash}`,
      BTC: `https://blockstream.info/tx/${txHash}`,
      XLM: `https://stellar.expert/explorer/public/tx/${txHash}`,
      USDC: `https://basescan.org/tx/${txHash}`,
      // Add more as needed
    }

    return explorerMap[asset] || `https://etherscan.io/tx/${txHash}`
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                transaction.direction === "credit"
                  ? "bg-success/15 text-success"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {transaction.direction === "credit" ? (
                <ArrowDownLeft className="h-5 w-5" />
              ) : (
                <ArrowUpRight className="h-5 w-5" />
              )}
            </span>
            <span className="capitalize">{transaction.description ?? transaction.type}</span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Amount */}
          <div>
            <p className="text-sm text-muted-foreground">Amount</p>
            <p
              className={cn(
                "mt-1 text-2xl font-bold tabular-nums",
                transaction.direction === "credit" ? "text-success" : ""
              )}
            >
              {transaction.direction === "credit" ? "+" : "-"}
              {transaction.amount} {transaction.asset}
            </p>
          </div>

          <Separator />

          {/* Status */}
          <div>
            <p className="text-sm text-muted-foreground">Status</p>
            <span
              className={cn(
                "mt-1 inline-block rounded px-2 py-1 text-xs font-medium uppercase tracking-wider",
                transaction.status === "completed"
                  ? "bg-success/15 text-success"
                  : transaction.status === "failed"
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {transaction.status}
            </span>
          </div>

          {/* Transaction Kind */}
          <div>
            <p className="text-sm text-muted-foreground">Type</p>
            <p className="mt-1 capitalize">{transaction.type}</p>
          </div>

          {/* Date and Time */}
          <div>
            <p className="text-sm text-muted-foreground">Date & Time</p>
            <p className="mt-1 text-sm">{formatDate(transaction.created_at)}</p>
          </div>

          {/* Reference */}
          {transaction.reference && (
            <div>
              <p className="text-sm text-muted-foreground">Reference</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="font-mono text-sm break-all">{transaction.reference}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => copyToClipboard(transaction.reference!, "reference")}
                >
                  {copiedField === "reference" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Counterparty */}
          {transaction.counterparty && (
            <div>
              <p className="text-sm text-muted-foreground">
                {transaction.direction === "credit" ? "From" : "To"}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-sm break-all">{transaction.counterparty}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => copyToClipboard(transaction.counterparty!, "counterparty")}
                >
                  {copiedField === "counterparty" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Transaction Hash */}
          {transaction.tx_hash && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Transaction Hash</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="font-mono text-xs break-all">{transaction.tx_hash}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => copyToClipboard(transaction.tx_hash!, "hash")}
                  >
                    {copiedField === "hash" ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Explorer Link */}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(getExplorerUrl(transaction.tx_hash!, transaction.asset), "_blank")}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View on Block Explorer
              </Button>
            </>
          )}

          {/* Transaction ID */}
          <div>
            <p className="text-sm text-muted-foreground">Transaction ID</p>
            <div className="mt-1 flex items-center gap-2">
              <p className="font-mono text-xs break-all text-muted-foreground">{transaction.id}</p>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => copyToClipboard(transaction.id, "id")}
              >
                {copiedField === "id" ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
