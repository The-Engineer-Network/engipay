"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Loader2, ShieldCheck, Upload, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { verifyReceipt, type ReceiptBlob } from "@/lib/api-client"

// ── helpers ───────────────────────────────────────────────────────────────────

function tryParseReceipt(raw: string): ReceiptBlob | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    // Route shape: {key_id, payload, signature}
    if (
      typeof parsed.key_id === "string" &&
      parsed.payload !== undefined &&
      typeof parsed.signature === "string"
    ) {
      return parsed as ReceiptBlob
    }
    // Service shape: {receipt: {...}, signature}
    if (
      typeof parsed.receipt === "object" &&
      parsed.receipt !== null &&
      typeof parsed.signature === "string"
    ) {
      return parsed as ReceiptBlob
    }
    return null
  } catch {
    return null
  }
}

function extractFields(blob: ReceiptBlob): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = []
  if ("key_id" in blob && "payload" in blob) {
    fields.push({ label: "Key ID", value: blob.key_id })
    if (typeof blob.payload === "object" && blob.payload !== null) {
      Object.entries(blob.payload as Record<string, unknown>).forEach(([k, v]) =>
        fields.push({ label: k, value: String(v) })
      )
    }
  } else if ("receipt" in blob) {
    const r = blob.receipt
    fields.push({ label: "Receipt ID", value: r.receipt_id })
    fields.push({ label: "Type", value: r.receipt_type })
    fields.push({ label: "Transaction", value: r.ledger_transaction_id })
    fields.push({ label: "Amount (minor units)", value: r.amount_minor })
    fields.push({ label: "Asset", value: r.asset })
    fields.push({ label: "Timestamp", value: r.timestamp })
    fields.push({ label: "Key ID", value: r.key_id })
    if (r.metadata) {
      Object.entries(r.metadata).forEach(([k, v]) => fields.push({ label: k, value: v }))
    }
  }
  return fields
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function VerifyReceiptPage() {
  const [raw, setRaw] = useState("")
  const [parseError, setParseError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [result, setResult] = useState<{ valid: boolean; blob: ReceiptBlob } | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // If a Verify link pre-filled the hash, decode and populate the textarea.
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    try {
      const decoded = decodeURIComponent(hash)
      setRaw(decoded)
    } catch {
      // ignore malformed hash
    }
  }, [])

  const handleTextChange = (val: string) => {
    setRaw(val)
    setParseError(null)
    setResult(null)
    setApiError(null)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => handleTextChange(ev.target?.result as string)
    reader.readAsText(file)
  }

  const handleVerify = async () => {
    setParseError(null)
    setResult(null)
    setApiError(null)

    const blob = tryParseReceipt(raw.trim())
    if (!blob) {
      setParseError(
        "Could not parse the receipt. Make sure it is valid JSON with the expected shape."
      )
      return
    }

    setVerifying(true)
    try {
      const res = await verifyReceipt(blob)
      setResult({ valid: res.valid, blob })
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Verification request failed.")
    } finally {
      setVerifying(false)
    }
  }

  const fields = result ? extractFields(result.blob) : []

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Home
        </Link>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Verify receipt</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Paste or upload a signed receipt to check whether it is authentic.
            </p>
          </div>
        </div>
      </div>

      {/* Input card */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <label htmlFor="receipt-input" className="mb-1.5 block text-sm font-medium">
              Receipt JSON
            </label>
            <textarea
              id="receipt-input"
              rows={8}
              value={raw}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={'{\n  "key_id": "...",\n  "payload": { ... },\n  "signature": "..."\n}'}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-describedby={parseError ? "parse-error" : undefined}
            />
            {parseError && (
              <p id="parse-error" role="alert" className="mt-1.5 text-xs text-destructive">
                {parseError}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleVerify} disabled={verifying || !raw.trim()}>
              {verifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Verifying…
                </>
              ) : (
                "Verify"
              )}
            </Button>

            <Button variant="outline" onClick={() => fileRef.current?.click()} type="button">
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
              Upload file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json,text/plain"
              className="sr-only"
              onChange={handleFileUpload}
              aria-label="Upload receipt file"
            />
          </div>

          {apiError && (
            <p role="alert" className="text-sm text-destructive">
              {apiError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card className="mt-6" aria-live="polite">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {result.valid ? (
                <>
                  <CheckCircle2
                    className="h-5 w-5 text-green-600 dark:text-green-400"
                    aria-hidden="true"
                  />
                  <span className="text-green-700 dark:text-green-400">Valid receipt</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
                  <span className="text-destructive">Invalid receipt</span>
                </>
              )}
            </CardTitle>
          </CardHeader>

          {result.valid && fields.length > 0 && (
            <CardContent>
              <dl className="divide-y divide-border">
                {fields.map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4"
                  >
                    <dt className="shrink-0 capitalize text-xs font-medium text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="break-all font-mono text-xs text-foreground sm:text-right">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          )}

          {!result.valid && (
            <CardContent>
              <p className="text-sm text-muted-foreground">
                The signature does not match the receipt contents. The receipt may have been
                tampered with or was signed with an unknown key.
              </p>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
