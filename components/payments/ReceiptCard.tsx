"use client"

import Link from "next/link"
import { Download, ShieldCheck } from "lucide-react"
import type { ReceiptBlob } from "@/lib/api-client"

interface ReceiptCardProps {
  /** The signed receipt to display. */
  receipt: ReceiptBlob
  /** Optional human-readable label shown above the links (e.g. "Transfer receipt"). */
  label?: string
  /** Extra className for the wrapper element. */
  className?: string
}

/**
 * Shows a compact signed-receipt card with:
 * - A Download link (saves the receipt as a .json file)
 * - A Verify link (opens /verify pre-filled with this receipt)
 *
 * Drop this wherever the app produces a signed receipt.
 */
export function ReceiptCard({ receipt, label = "Receipt", className = "" }: ReceiptCardProps) {
  const json = JSON.stringify(receipt, null, 2)
  const encoded = encodeURIComponent(json)
  const dataUri = `data:application/json;charset=utf-8,${encoded}`

  // Build a stable file name from the receipt ID when available.
  let filename = "receipt.json"
  if ("receipt" in receipt) {
    filename = `receipt-${receipt.receipt.receipt_id}.json`
  } else if ("key_id" in receipt) {
    filename = `receipt-${receipt.key_id}.json`
  }

  // Pre-fill the /verify page by encoding the JSON in the hash so it never
  // hits the server and no PII leaks into server logs.
  const verifyHref = `/verify#${encodeURIComponent(json)}`

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 ${className}`}
    >
      <span className="text-sm font-medium text-foreground">{label}</span>

      <div className="flex items-center gap-2 shrink-0">
        {/* Download */}
        <a
          href={dataUri}
          download={filename}
          aria-label={`Download ${label} as JSON`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download
        </a>

        {/* Verify */}
        <Link
          href={verifyHref}
          aria-label={`Verify ${label}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Verify
        </Link>
      </div>
    </div>
  )
}
