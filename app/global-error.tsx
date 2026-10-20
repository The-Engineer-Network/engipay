"use client"

import { useEffect } from "react"

/** Replaces the root layout when it fails, so it brings its own html and body and uses inline styles. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          background: "#050806",
          color: "#f5f7f6",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: 360, fontSize: 14, margin: 0, opacity: 0.7 }}>
          EngiPay hit an unexpected problem. Your funds are not affected. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: 0,
            background: "#22c55e",
            color: "#052e16",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
