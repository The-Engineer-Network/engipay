"use client"

import { useEffect, useState, useCallback } from "react"
import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  listMoneyRequests,
  acceptMoneyRequest,
  declineMoneyRequest,
  type MoneyRequestRow,
} from "@/lib/api-client"
import { HandCoins, Inbox, Clock } from "lucide-react"

function statusVariant(
  status: MoneyRequestRow["status"]
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "pending":
      return "default"
    case "accepted":
      return "secondary"
    case "declined":
      return "destructive"
    case "expired":
      return "outline"
  }
}

function formatExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return "Expired"
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m left`
  return `${m}m left`
}

export default function MoneyRequestInboxPage() {
  const [rows, setRows] = useState<MoneyRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listMoneyRequests()
      setRows(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load requests.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleAccept(row: MoneyRequestRow) {
    setActing(row.id)
    try {
      // Generate a stable idempotency key from the request id so retapping
      // the button never books a second payment.
      const key = crypto.randomUUID()
      await acceptMoneyRequest(row.id, key)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Accept failed.")
    } finally {
      setActing(null)
    }
  }

  async function handleDecline(row: MoneyRequestRow) {
    setActing(row.id)
    try {
      await declineMoneyRequest(row.id)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Decline failed.")
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Money requests"
        description="Requests others have sent you and requests you have created."
      />

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-border bg-card"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No money requests yet.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Money requests">
          {rows.map((row) => {
            const isIncoming = row.requester_tag !== null
            const isPending = row.status === "pending"
            const isActing = acting === row.id

            return (
              <li key={row.id}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <HandCoins
                          className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <div>
                          <p className="text-sm font-medium">
                            {isIncoming ? (
                              <>
                                <span className="font-semibold">{row.requester_tag}</span>{" "}
                                is requesting
                              </>
                            ) : (
                              <>
                                You requested from{" "}
                                <span className="font-semibold">{row.recipient_tag}</span>
                              </>
                            )}
                          </p>
                          <p className="tabular-nums text-lg font-bold">
                            {row.amount} {row.asset}
                          </p>
                          {row.note && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{row.note}</p>
                          )}
                          {isPending && (
                            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              {formatExpiry(row.expires_at)}
                            </p>
                          )}
                        </div>
                      </div>

                      <Badge variant={statusVariant(row.status)} className="shrink-0 capitalize">
                        {row.status}
                      </Badge>
                    </div>

                    {/* Action buttons — only for incoming pending requests */}
                    {isIncoming && isPending && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={isActing}
                          onClick={() => handleAccept(row)}
                          aria-label={`Accept request from ${row.requester_tag}`}
                        >
                          {isActing ? "Processing…" : "Accept & pay"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          disabled={isActing}
                          onClick={() => handleDecline(row)}
                          aria-label={`Decline request from ${row.requester_tag}`}
                        >
                          Decline
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
