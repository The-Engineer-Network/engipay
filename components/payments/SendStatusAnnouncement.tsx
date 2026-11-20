"use client"

import { useEffect, useState } from "react"

interface SendStatusAnnouncementProps {
  message: string
}

/**
 * Visually hidden polite live region for payment send status.
 *
 * The region mounts empty and receives its text in an effect. That way the
 * change is announced even when a form swaps to its success view, which would
 * otherwise mount the region and its text at the same time.
 */
export function SendStatusAnnouncement({ message }: SendStatusAnnouncementProps) {
  const [announcement, setAnnouncement] = useState("")

  useEffect(() => {
    setAnnouncement(message)
  }, [message])

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  )
}
