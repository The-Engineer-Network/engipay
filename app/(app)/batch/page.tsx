"use client"

import { useState, useRef, useTransition } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  UploadCloud,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  Play,
  Check,
  RefreshCw,
  XCircle,
  ArrowRight,
  ShieldAlert,
} from "lucide-react"
import {
  parseAndValidateCsv,
  filterRowsForExecution,
  APPROVAL_THRESHOLD_USDC,
  type BatchSummary,
} from "@/lib/batch-payments"
import {
  uploadBatchPayment,
  getBatchPaymentStatus,
  getBatchPaymentRows,
  approveBatchPayment,
  executeBatchPayment,
  type BatchPaymentStatus,
  type RowResult,
} from "@/lib/api-client"

const SAMPLE_CSV = `destination,asset,amount,memo
GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5,USDC,150.00,payroll_oct
0x71C7656EC7ab88b098defB751B7401B5f6d8976F,USDC,200.00,dev_stipend
@alice,USDC,75.00,design_bonus
@bob_contractor,USDC,125.00,consulting`

export default function BatchPaymentsPage() {
  const [csvText, setCsvText] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batchStatus, setBatchStatus] = useState<BatchPaymentStatus | null>(null)
  const [rows, setRows] = useState<RowResult[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    setFile(selected)
    setErrorMessage(null)

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      setCsvText(text)
      const parsed = parseAndValidateCsv(text)
      setSummary(parsed)
    }
    reader.readAsText(selected)
  }

  const loadSample = () => {
    setCsvText(SAMPLE_CSV)
    const blob = new File([SAMPLE_CSV], "sample_payroll.csv", { type: "text/csv" })
    setFile(blob)
    const parsed = parseAndValidateCsv(SAMPLE_CSV)
    setSummary(parsed)
    setErrorMessage(null)
  }

  const handleUpload = async () => {
    if (!file && !csvText) {
      setErrorMessage("Please select or paste a CSV file.")
      return
    }

    setIsUploading(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const fileToUpload =
        file || new File([csvText], "batch.csv", { type: "text/csv" })
      const res = await uploadBatchPayment(fileToUpload)
      setBatchId(res.batch_id)
      setBatchStatus(res)
      setSuccessMessage(`Batch created successfully (${res.total_rows} rows). Status: ${res.status}`)

      // Fetch row items
      const rowResults = await getBatchPaymentRows(res.batch_id)
      setRows(rowResults)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload batch CSV"
      setErrorMessage(msg)
    } finally {
      setIsUploading(false)
    }
  }

  const handleApprove = async () => {
    if (!batchId) return
    setIsApproving(true)
    setErrorMessage(null)
    try {
      await approveBatchPayment(batchId)
      setBatchStatus(await getBatchPaymentStatus(batchId))
      setSuccessMessage("Batch approved by second signer! Ready for execution.")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to approve batch"
      setErrorMessage(msg)
    } finally {
      setIsApproving(false)
    }
  }

  const handleExecute = async () => {
    if (!batchId) return
    setIsExecuting(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const res = await executeBatchPayment(batchId)
      setBatchStatus(res)
      const updatedRows = await getBatchPaymentRows(batchId)
      setRows(updatedRows)
      setSuccessMessage(
        `Execution finished. Successful: ${res.successful}, Failed: ${res.failed}`
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Execution failed"
      setErrorMessage(msg)
    } finally {
      setIsExecuting(false)
    }
  }

  const refreshBatch = async () => {
    if (!batchId) return
    try {
      const [statusRes, rowsRes] = await Promise.all([
        getBatchPaymentStatus(batchId),
        getBatchPaymentRows(batchId),
      ])
      setBatchStatus(statusRes)
      setRows(rowsRes)
    } catch (err: unknown) {
      console.error("Refresh failed:", err)
    }
  }

  const pendingRowsToExecute = filterRowsForExecution(rows)
  const percentComplete =
    batchStatus && batchStatus.total_rows > 0
      ? Math.round((batchStatus.processed_rows / batchStatus.total_rows) * 100)
      : 0

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Batch Payments"
        description="Pay many recipients in one CSV upload. Validates every row upfront, enforces dual-approval above threshold, and guarantees idempotent execution."
      />

      {/* Main Upload / Config Card */}
      {!batchId ? (
        <Card className="border border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">Upload Recipient CSV</CardTitle>
                <CardDescription>
                  Columns supported: <code>destination, asset, amount, memo</code>
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={loadSample}>
                Load Sample CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <UploadCloud className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">
                {file ? file.name : "Click to select or drag & drop recipient CSV"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Max 500 rows. Stellar (G/M), EVM (0x), Bitcoin, or @tags accepted.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {summary && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-border p-3 bg-card">
                    <p className="text-xs text-muted-foreground">Total Rows</p>
                    <p className="text-2xl font-bold">{summary.totalRows}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3 bg-card">
                    <p className="text-xs text-success">Valid Rows</p>
                    <p className="text-2xl font-bold text-success">{summary.validRows}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3 bg-card">
                    <p className="text-xs text-destructive">Invalid Rows</p>
                    <p className="text-2xl font-bold text-destructive">{summary.invalidRows}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3 bg-card">
                    <p className="text-xs text-muted-foreground">Estimated Total</p>
                    <p className="text-2xl font-bold">${summary.estimatedTotalUsd.toFixed(2)}</p>
                  </div>
                </div>

                {summary.requiresApproval && (
                  <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-500">
                    <ShieldAlert className="h-5 w-5 shrink-0" />
                    <p className="text-xs leading-relaxed">
                      <strong>Threshold Exceeded:</strong> Total exceeds ${APPROVAL_THRESHOLD_USDC} USDC.
                      Dual-authorization by a second distinct account is required before execution.
                    </p>
                  </div>
                )}

                {summary.invalidRows > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive text-xs">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>
                      Please fix the {summary.invalidRows} invalid row(s) before uploading. Every row must be valid.
                    </span>
                  </div>
                )}

                {/* Preview Table */}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="p-2.5">Row</th>
                        <th className="p-2.5">Destination</th>
                        <th className="p-2.5">Asset</th>
                        <th className="p-2.5">Amount</th>
                        <th className="p-2.5">Memo</th>
                        <th className="p-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {summary.rows.map((r) => (
                        <tr key={r.rowNumber} className={r.isValid ? "" : "bg-destructive/5"}>
                          <td className="p-2.5 font-mono">{r.rowNumber}</td>
                          <td className="p-2.5 font-mono truncate max-w-[180px]">{r.destination}</td>
                          <td className="p-2.5 font-semibold">{r.asset}</td>
                          <td className="p-2.5 tabular-nums font-medium">{r.amount}</td>
                          <td className="p-2.5 text-muted-foreground truncate max-w-[100px]">
                            {r.memo || "—"}
                          </td>
                          <td className="p-2.5">
                            {r.isValid ? (
                              <Badge variant="outline" className="text-success border-success/30">
                                Valid
                              </Badge>
                            ) : (
                              <Badge variant="destructive">{r.error || "Invalid"}</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Button
                  onClick={handleUpload}
                  disabled={isUploading || summary.invalidRows > 0 || summary.validRows === 0}
                  className="w-full h-11 text-base font-semibold"
                >
                  {isUploading ? "Uploading & Validating..." : "Upload & Prepare Batch"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Batch Execution & Tracking Card */
        <div className="space-y-6">
          <Card className="border border-border">
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">Batch #{batchId.slice(0, 8)}</CardTitle>
                    <Badge
                      variant={
                        batchStatus?.status === "completed"
                          ? "default"
                          : batchStatus?.status === "awaiting_approval"
                          ? "outline"
                          : "secondary"
                      }
                    >
                      {batchStatus?.status}
                    </Badge>
                  </div>
                  <CardDescription className="font-mono text-xs mt-1">
                    ID: {batchId}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={refreshBatch}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    Refresh
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBatchId(null)
                      setBatchStatus(null)
                      setRows([])
                    }}
                  >
                    New Upload
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Execution Progress</span>
                  <span className="font-mono font-medium">{percentComplete}%</span>
                </div>
                <Progress value={percentComplete} className="h-2" />
              </div>

              {/* Status Counters */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Total Rows</p>
                  <p className="text-xl font-bold">{batchStatus?.total_rows ?? 0}</p>
                </div>
                <div className="rounded-lg border border-border p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Processed</p>
                  <p className="text-xl font-bold">{batchStatus?.processed_rows ?? 0}</p>
                </div>
                <div className="rounded-lg border border-border p-3 bg-card">
                  <p className="text-xs text-success">Successful</p>
                  <p className="text-xl font-bold text-success">{batchStatus?.successful ?? 0}</p>
                </div>
                <div className="rounded-lg border border-border p-3 bg-card">
                  <p className="text-xs text-destructive">Failed</p>
                  <p className="text-xl font-bold text-destructive">{batchStatus?.failed ?? 0}</p>
                </div>
              </div>

              {/* Action Buttons based on status */}
              <div className="flex flex-col gap-3 sm:flex-row">
                {batchStatus?.status === "awaiting_approval" && (
                  <Button
                    onClick={handleApprove}
                    disabled={isApproving}
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <Check className="h-4 w-4 mr-2" />
                    {isApproving ? "Approving..." : "Authorize as 2nd Signer"}
                  </Button>
                )}

                {(batchStatus?.status === "pending" ||
                  batchStatus?.status === "processing" ||
                  (batchStatus?.status === "completed" && (batchStatus?.failed ?? 0) > 0)) && (
                  <Button
                    onClick={handleExecute}
                    disabled={isExecuting || pendingRowsToExecute.length === 0}
                    className="flex-1"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    {isExecuting
                      ? "Executing rows idempotently..."
                      : pendingRowsToExecute.length === 0
                      ? "All rows executed"
                      : `Execute Next ${pendingRowsToExecute.length} Row(s)`}
                  </Button>
                )}
              </div>

              {/* Idempotency Assurance Banner */}
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                <span>
                  <strong>Idempotency Invariant:</strong> Re-running this batch will skip previously
                  paid rows and will never double-spend.
                </span>
              </div>

              {/* Detailed Row Outcomes Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Row-by-Row Execution Log
                </h4>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="p-2.5">Row</th>
                        <th className="p-2.5">Destination</th>
                        <th className="p-2.5">Asset</th>
                        <th className="p-2.5">Amount</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5">Tx Hash / Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-muted-foreground">
                            No row details yet. Click execute to begin.
                          </td>
                        </tr>
                      ) : (
                        rows.map((row) => (
                          <tr key={row.row_number}>
                            <td className="p-2.5 font-mono">{row.row_number}</td>
                            <td className="p-2.5 font-mono truncate max-w-[150px]">
                              {row.destination}
                            </td>
                            <td className="p-2.5 font-semibold">{row.asset}</td>
                            <td className="p-2.5 tabular-nums">{row.amount}</td>
                            <td className="p-2.5">
                              {row.status === "success" ? (
                                <Badge variant="outline" className="text-success border-success/30">
                                  Success
                                </Badge>
                              ) : row.status === "failed" ? (
                                <Badge variant="destructive">Failed</Badge>
                              ) : (
                                <Badge variant="secondary">Pending</Badge>
                              )}
                            </td>
                            <td className="p-2.5 font-mono text-[11px] truncate max-w-[180px]">
                              {row.tx_hash ? (
                                <span className="text-success">{row.tx_hash}</span>
                              ) : row.error ? (
                                <span className="text-destructive">{row.error}</span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Notifications */}
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
          <XCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-success text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}
    </div>
  )
}
