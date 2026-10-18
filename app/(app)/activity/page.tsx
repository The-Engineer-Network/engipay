"use client"

import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useEngiPayTransactions } from "@/hooks/use-engipay-transactions"
import { ArrowUpRight, ArrowDownLeft, Receipt, Loader2, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

export default function ActivityPage() {
  const { transactions, isLoading, isLoadingMore, hasMore, loadMore, error } =
    useEngiPayTransactions({ limit: 15 })

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Activity"
        description="Every payment, conversion and Naira transfer in one list."
      />

      {error && (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : transactions.length > 0 ? (
        <div className="space-y-4">
          <ul className="space-y-2">
            {transactions.map((tx) => (
              <li
                key={tx.id}
                className="lift-card glass-panel flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm",
                      tx.direction === "credit"
                        ? "bg-success/15 text-success"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {tx.direction === "credit" ? (
                      <ArrowDownLeft className="h-5 w-5" />
                    ) : (
                      <ArrowUpRight className="h-5 w-5" />
                    )}
                  </span>
                  <div>
                    <span className="block text-sm font-medium capitalize">
                      {tx.description ?? tx.type}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {new Date(tx.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span
                    className={cn(
                      "block font-semibold tabular-nums",
                      tx.direction === "credit" ? "text-success" : ""
                    )}
                  >
                    {tx.direction === "credit" ? "+" : "-"}
                    {tx.amount} {tx.asset}
                  </span>
                  <div className="flex items-center justify-end gap-1.5 mt-0.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                        tx.status === "completed"
                          ? "bg-success/15 text-success"
                          : tx.status === "failed"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {tx.status}
                    </span>
                    {tx.tx_hash && (
                      <span
                        title={tx.tx_hash}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="pt-2 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={isLoadingMore}
                className="rounded-full"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load older activity"
                )}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Receipt className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="font-medium">No activity yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Once you send, receive or convert, it shows up here with its status and a link to the
              block explorer.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
