"use client"

import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle2, Clock, ExternalLink, Loader2, XCircle } from "lucide-react"
import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  getWithdrawal,
  WITHDRAWAL_FINAL_STATUSES,
  type Withdrawal,
  type WithdrawalStatus,
} from "@/lib/api-client"

// ── constants ────────────────────────────────────────────────────────────────

/** Re-fetch interval while in a non-final state (ms). */
const POLL_INTERVAL_MS = 4_000

// ── helpers ───────────────────────────────────────────────────────────────────

function isFinal(status: WithdrawalStatus): boolean {
  return (WITHDRAWAL_FINAL_STATUSES as readonly string[]).includes(status)
}

function formatAmount(amount: number): string {
  return (amount / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function timeUntil(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now()
  if (diffMs <= 0) return "shortly"
  const mins = Math.round(diffMs / 60_000)
  if (mins < 60) return `in about ${mins} minute${mins !== 1 ? "s" : ""}`
  const hours = Math.round(diffMs / 3_600_000)
  return `in about ${hours} hour${hours !== 1 ? "s" : ""}`
}

// ── status badge ──────────────────────────────────────────────────────────────

type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

const STATUS_CONFIG: Record<WithdrawalStatus, { label: string; variant: BadgeVariant }> = {
  pending:    { label: "Pending",    variant: "secondary" },
  held:       { label: "Held",       variant: "outline" },
  processing: { label: "Processing", variant: "secondary" },
  completed:  { label: "Completed",  variant: "default" },
  failed:     { label: "Failed",     variant: "destructive" },
  cancelled:  { label: "Cancelled",  variant: "destructive" },
}

function StatusBadge({ status }: { status: WithdrawalStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, variant: "secondary" as BadgeVariant }
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>
}

// ── status icon ───────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: WithdrawalStatus }) {
  if (status === "completed") {
    return (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </span>
    )
  }
  if (status === "failed" || status === "cancelled") {
    return (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <XCircle className="h-7 w-7" aria-hidden="true" />
      </span>
    )
  }
  if (status === "held") {
    return (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
        <Clock className="h-7 w-7" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
    </span>
  )
}

// ── cooling-off notice ────────────────────────────────────────────────────────

function CoolingOffNotice({ coolingOffUntil }: { coolingOffUntil: string }) {
  const [, setTick] = useState(0)

  // Re-render every minute so "in X minutes" stays accurate.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
    >
      <div className="flex items-start gap-3">
        <Clock
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Cooling-off period active
          </p>
          <p className="text-amber-800 dark:text-amber-300">
            This withdrawal is going to a new destination address. As a
            security measure, funds are held for a short period before they
            are released.
          </p>
          <p className="text-amber-800 dark:text-amber-300">
            Expected release:{" "}
            <strong>
              {formatDateTime(coolingOffUntil)} ({timeUntil(coolingOffUntil)})
            </strong>
          </p>
        </div>
      </div>
    </div>
  )
}

// ── detail row ────────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm font-medium text-foreground sm:text-right">{children}</dd>
    </div>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function WithdrawalStatusPage() {
  const params = useParams()
  const id =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : ""

  const [withdrawal, setWithdrawal] = useState<Withdrawal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchWithdrawal = async () => {
    try {
      const data = await getWithdrawal(id)
      setWithdrawal(data)
      setError(null)
      // Keep polling until we reach a terminal state.
      if (!isFinal(data.status)) {
        pollRef.current = setTimeout(fetchWithdrawal, POLL_INTERVAL_MS)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load withdrawal.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!id) return
    void fetchWithdrawal()
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Withdrawal"
        description="Track this withdrawal to its destination."
        backHref="/dashboard"
      />

      {loading && (
        <Card>
          <CardContent className="flex items-center justify-center p-12">
            <Loader2
              className="h-6 w-6 animate-spin text-muted-foreground"
              aria-label="Loading withdrawal…"
            />
          </CardContent>
        </Card>
      )}

      {!loading && error && (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && withdrawal && (
        <Card>
          <CardContent className="p-6">
            {/* Status hero */}
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <StatusIcon status={withdrawal.status} />
              <div>
                <p className="text-xl font-semibold">
                  {formatAmount(withdrawal.amount)}{" "}
                  <span className="text-base font-normal text-muted-foreground">NGN</span>
                </p>
                <div className="mt-1.5">
                  <StatusBadge status={withdrawal.status} />
                </div>
              </div>
            </div>

            {/* Detail list */}
            <dl className="divide-y divide-border">
              <DetailRow label="Withdrawal ID">
                <span className="font-mono text-xs">{withdrawal.id}</span>
              </DetailRow>

              <DetailRow label="Destination">
                <span className="font-mono text-xs">{withdrawal.destination}</span>
              </DetailRow>

              <DetailRow label="Amount">
                {formatAmount(withdrawal.amount)} NGN
              </DetailRow>

              <DetailRow label="Network fee (est.)">
                {formatAmount(withdrawal.estimated_network_fee)} NGN
              </DetailRow>

              {withdrawal.tx_hash && (
                <DetailRow label="Transaction">
                  <a
                    href={`https://blockchair.com/search?q=${withdrawal.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs text-primary underline-offset-4 hover:underline"
                  >
                    {withdrawal.tx_hash.slice(0, 16)}…
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </a>
                </DetailRow>
              )}
            </dl>

            {/* Cooling-off explanation when held */}
            {withdrawal.status === "held" && withdrawal.cooling_off_until && (
              <CoolingOffNotice coolingOffUntil={withdrawal.cooling_off_until} />
            )}

            {/* Live polling indicator */}
            {!isFinal(withdrawal.status) && (
              <p
                role="status"
                aria-live="polite"
                className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Checking for updates every few seconds…
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
