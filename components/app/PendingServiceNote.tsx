import { Info } from "lucide-react"

interface PendingServiceNoteProps {
  /** What is missing, in plain words. */
  children: React.ReactNode
}

/**
 * Says plainly that a screen is finished as a design but cannot complete the
 * action yet. Better than a fake success, and better than a dead button with
 * no explanation.
 */
export function PendingServiceNote({ children }: PendingServiceNoteProps) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}
