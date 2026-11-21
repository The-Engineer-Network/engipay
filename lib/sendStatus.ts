/**
 * Wording for the polite live region used by the payment send forms.
 * Keeping this in a pure helper makes the announcement behaviour testable and
 * consistent across the Base, Stellar and EngiPay-balance forms.
 */

export type SendPhase = "idle" | "waiting" | "success" | "error"

export interface SendStatus {
  phase: SendPhase
  /** Extra context, e.g. why the payment is waiting or what went wrong. */
  detail?: string
}

/**
 * Returns the text to publish to an aria-live region. A completed send wins
 * over a stale error, and an error wins over a stale "waiting" message, so the
 * announcement always matches the current state of the form.
 */
export function getSendStatusAnnouncement({ phase, detail }: SendStatus): string {
  switch (phase) {
    case "waiting":
      return detail ? `Sending payment. ${detail}` : "Sending payment."
    case "success":
      return "Payment sent successfully."
    case "error":
      return detail ? `Payment failed. ${detail}` : "Payment failed."
    case "idle":
      return ""
  }
}
