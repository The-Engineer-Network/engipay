"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  ExternalLink,
  ArrowLeft,
  AlertCircle 
} from "lucide-react"
import { apiClient } from "@/lib/api-client"
import { cn } from "@/lib/utils"

interface WithdrawalStatus {
  id: string
  asset: string
  chain: string
  destination: string
  amount: string
  estimated_network_fee: string
  status: "pending" | "processing" | "completed" | "failed" | "held"
  cooling_off_until?: string | null
  tx_hash?: string | null
  created_at: string
}

export default function WithdrawalStatusPage() {
  const params = useParams()
  const router = useRouter()
  const withdrawalId = params.id as string

  const [withdrawal, setWithdrawal] = useState<WithdrawalStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Poll for status updates
  useEffect(() => {
    let cancelled = false
    let pollInterval: NodeJS.Timeout | null = null

    const fetchStatus = async () => {
      try {
        const status = await apiClient.getWithdrawalStatus(withdrawalId)
        if (!cancelled) {
          setWithdrawal(status)
          setIsLoading(false)

          // Stop polling if in final state
          if (status.status === "completed" || status.status === "failed") {
            if (pollInterval) clearInterval(pollInterval)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load withdrawal status")
          setIsLoading(false)
          if (pollInterval) clearInterval(pollInterval)
        }
      }
    }

    // Initial fetch
    fetchStatus()

    // Poll every 3 seconds for updates
    pollInterval = setInterval(fetchStatus, 3000)

    return () => {
      cancelled = true
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [withdrawalId])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-12 w-12 text-success" />
      case "failed":
        return <XCircle className="h-12 w-12 text-destructive" />
      case "held":
        return <Clock className="h-12 w-12 text-warning" />
      case "processing":
        return <Loader2 className="h-12 w-12 animate-spin text-primary" />
      case "pending":
      default:
        return <Clock className="h-12 w-12 text-muted-foreground" />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case "completed":
        return "Withdrawal Completed"
      case "failed":
        return "Withdrawal Failed"
      case "held":
        return "Withdrawal On Hold"
      case "processing":
        return "Processing Withdrawal"
      case "pending":
      default:
        return "Withdrawal Pending"
    }
  }

  const getStatusDescription = (status: string, coolingOffUntil?: string | null) => {
    switch (status) {
      case "completed":
        return "Your withdrawal has been sent successfully."
      case "failed":
        return "The withdrawal could not be processed. The funds have been returned to your balance."
      case "held":
        if (coolingOffUntil) {
          const releaseDate = new Date(coolingOffUntil)
          return `For security, withdrawals to new addresses are held for 24 hours. This withdrawal will be released on ${releaseDate.toLocaleString()}.`
        }
        return "This withdrawal is on hold for security review."
      case "processing":
        return "Your withdrawal is being processed and will be sent to the blockchain shortly."
      case "pending":
      default:
        return "Your withdrawal request has been received and is queued for processing."
    }
  }

  const getExplorerUrl = (chain: string, txHash: string) => {
    const explorerMap: Record<string, string> = {
      stellar: `https://stellar.expert/explorer/public/tx/${txHash}`,
      base: `https://basescan.org/tx/${txHash}`,
      bitcoin: `https://blockstream.info/tx/${txHash}`,
    }
    return explorerMap[chain] || `https://etherscan.io/tx/${txHash}`
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Withdrawal Status" description="Checking withdrawal status..." />
        <Card>
          <CardContent className="space-y-6 p-8">
            <div className="flex flex-col items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-full" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !withdrawal) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Withdrawal Status" description="Unable to load withdrawal" />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || "Withdrawal not found"}</AlertDescription>
        </Alert>
        <div className="mt-6">
          <Button variant="outline" onClick={() => router.push("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Withdrawal Status"
        description={`Track your ${withdrawal.asset} withdrawal`}
      />

      <Card>
        <CardContent className="space-y-8 p-8">
          {/* Status Icon and Title */}
          <div className="flex flex-col items-center gap-4 text-center">
            {getStatusIcon(withdrawal.status)}
            <div>
              <h2 className="text-2xl font-bold">{getStatusText(withdrawal.status)}</h2>
              <p className="mt-2 text-muted-foreground">
                {getStatusDescription(withdrawal.status, withdrawal.cooling_off_until)}
              </p>
            </div>
          </div>

          {/* Cooling Off Alert */}
          {withdrawal.status === "held" && withdrawal.cooling_off_until && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>
                <strong>Security hold active</strong>
                <br />
                Withdrawals to new addresses require a 24-hour cooling-off period. Your funds will
                be sent automatically when the hold expires.
              </AlertDescription>
            </Alert>
          )}

          {/* Withdrawal Details */}
          <div className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Amount</span>
              <span className="font-semibold">
                {withdrawal.amount} {withdrawal.asset}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Network Fee</span>
              <span className="font-medium">
                {withdrawal.estimated_network_fee} {withdrawal.asset}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Network</span>
              <span className="font-medium capitalize">{withdrawal.chain}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Destination</span>
              <span className="font-mono text-xs break-all">{withdrawal.destination}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm">
                {new Date(withdrawal.created_at).toLocaleString()}
              </span>
            </div>
            {withdrawal.cooling_off_until && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Release Time</span>
                <span className="text-sm">
                  {new Date(withdrawal.cooling_off_until).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {/* Transaction Hash */}
          {withdrawal.tx_hash && (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Transaction Hash</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs break-all">
                  {withdrawal.tx_hash}
                </code>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  window.open(getExplorerUrl(withdrawal.chain, withdrawal.tx_hash!), "_blank")
                }
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View on Block Explorer
              </Button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => router.push("/activity")} className="flex-1">
              View Activity
            </Button>
            <Button variant="outline" onClick={() => router.push("/dashboard")} className="flex-1">
              Back to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
