"use client"

import { useEffect, useRef, useState } from "react"
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Camera, X, AlertCircle } from "lucide-react"

interface QRScannerProps {
  /** Receives the raw text of the scanned code. Parsing is the caller's job. */
  onScan: (text: string) => void
  onClose?: () => void
}

/** The element html5-qrcode mounts its video into. */
const REGION_ID = "engipay-qr-region"

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualEntry, setManualEntry] = useState("")
  const scannerRef = useRef<Html5Qrcode | null>(null)

  // Always release the camera, including on route changes.
  useEffect(() => {
    return () => {
      const scanner = scannerRef.current
      if (scanner && scanner.isScanning) {
        scanner.stop().catch(() => {})
      }
      scannerRef.current = null
    }
  }, [])

  const stop = async () => {
    const scanner = scannerRef.current
    if (scanner && scanner.isScanning) {
      try {
        await scanner.stop()
      } catch {
        // Already stopped; nothing to do.
      }
    }
    setIsScanning(false)
  }

  const start = async () => {
    setError(null)
    try {
      const scanner = new Html5Qrcode(REGION_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      })
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        (decodedText) => {
          // Stop first, so a second frame cannot fire the callback twice.
          stop().then(() => onScan(decodedText))
        },
        () => {
          // Fires constantly for frames without a code. Not an error.
        }
      )
      setIsScanning(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(
        /permission|denied|notallowed/i.test(message)
          ? "Camera access was denied. Allow the camera in your browser settings, or paste the code below."
          : "The camera could not be started. You can paste the code below instead."
      )
      setIsScanning(false)
    }
  }

  const submitManual = (event: React.FormEvent) => {
    event.preventDefault()
    const value = manualEntry.trim()
    if (value) onScan(value)
  }

  return (
    <div className="space-y-4">
      <div
        id={REGION_ID}
        className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted"
      >
        {!isScanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Camera className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Point your camera at a payment code to read it.
            </p>
            <Button type="button" onClick={start}>
              Start camera
            </Button>
          </div>
        )}
      </div>

      {isScanning && (
        <Button type="button" variant="outline" className="w-full" onClick={stop}>
          <X className="mr-2 h-4 w-4" aria-hidden="true" />
          Stop camera
        </Button>
      )}

      {error && (
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <form onSubmit={submitManual} className="space-y-2">
        <Label htmlFor="manual-code">Or paste a code or address</Label>
        <div className="flex gap-2">
          <Input
            id="manual-code"
            value={manualEntry}
            onChange={(event) => setManualEntry(event.target.value)}
            placeholder="0x… or bitcoin:… or ethereum:…"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="secondary" disabled={!manualEntry.trim()}>
            Use
          </Button>
        </div>
      </form>

      {onClose && (
        <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
          Cancel
        </Button>
      )}
    </div>
  )
}
