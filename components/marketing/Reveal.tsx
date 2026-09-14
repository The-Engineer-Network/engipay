"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

interface RevealProps {
  children: ReactNode
  /** Milliseconds to wait after the element enters view. Use for stagger. */
  delay?: number
  /** "up" slides in from below, "scale" grows in slightly. */
  variant?: "up" | "scale"
  /** Which element to render. Defaults to a div. */
  as?: keyof JSX.IntrinsicElements
  className?: string
}

/**
 * Reveals its children the first time they scroll into view, once only.
 * The animation itself lives in CSS (.reveal), so users who ask for reduced
 * motion simply see the content with no movement.
 */
export function Reveal({
  children,
  delay = 0,
  variant = "up",
  as = "div",
  className,
}: RevealProps) {
  // Cast so the element accepts a ref and the usual HTML props. The runtime
  // tag is still whatever `as` says.
  const Tag = as as "div"
  const ref = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    // No observer (very old browser): show it rather than hide it forever.
    if (typeof IntersectionObserver === "undefined") {
      setRevealed(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref}
      data-revealed={revealed}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(variant === "scale" ? "reveal-scale" : "reveal", className)}
    >
      {children}
    </Tag>
  )
}
