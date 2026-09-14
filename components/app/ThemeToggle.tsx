"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "engipay-theme-toggle-position"
const EDGE_GAP = 20
/** Pointer travel, in px, past which a press counts as a drag and not a tap. */
const DRAG_THRESHOLD = 4

interface Position {
  x: number
  y: number
}

/**
 * A small vertical switch that floats above the page and can be dragged
 * anywhere on screen. Tap it to swap light and dark; drag it out of the way
 * when it covers something. Its position is remembered per device.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const nodeRef = useRef<HTMLDivElement>(null)
  const dragState = useRef({ startX: 0, startY: 0, originX: 0, originY: 0, moved: false })

  const clamp = useCallback((next: Position): Position => {
    const node = nodeRef.current
    const width = node?.offsetWidth ?? 44
    const height = node?.offsetHeight ?? 84
    return {
      x: Math.min(Math.max(next.x, EDGE_GAP), window.innerWidth - width - EDGE_GAP),
      y: Math.min(Math.max(next.y, EDGE_GAP), window.innerHeight - height - EDGE_GAP),
    }
  }, [])

  // Restore the saved spot, or start in the bottom-right corner.
  useEffect(() => {
    setMounted(true)
    let initial: Position | null = null
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) initial = JSON.parse(saved) as Position
    } catch {
      initial = null
    }
    setPosition(
      initial ?? { x: window.innerWidth - 44 - EDGE_GAP, y: window.innerHeight - 84 - 28 }
    )
  }, [])

  // Keep it on screen when the window is resized or the phone is rotated.
  useEffect(() => {
    if (!position) return
    const onResize = () => setPosition((current) => (current ? clamp(current) : current))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [position, clamp])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!position) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const dx = event.clientX - dragState.current.startX
    const dy = event.clientY - dragState.current.startY

    if (!dragState.current.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragState.current.moved = true
    }
    if (!dragState.current.moved) return

    setPosition(clamp({ x: dragState.current.originX + dx, y: dragState.current.originY + dy }))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setIsDragging(false)

    if (dragState.current.moved) {
      // It was a drag: remember where it landed, and do not toggle.
      setPosition((current) => {
        if (current) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
          } catch {
            // Private mode, or storage is full. The position just will not persist.
          }
        }
        return current
      })
      return
    }

    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }

  if (!mounted || !position) return null

  const isDark = resolvedTheme === "dark"

  return (
    <div
      ref={nodeRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setIsDragging(false)}
      style={{ left: position.x, top: position.y }}
      className={cn(
        "fixed z-[999] touch-none select-none",
        isDragging ? "cursor-grabbing" : "cursor-grab",
        !isDragging && "transition-transform duration-300"
      )}
    >
      <button
        type="button"
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        aria-pressed={isDark}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setTheme(isDark ? "light" : "dark")
          }
        }}
        className={cn(
          "group relative flex h-[84px] w-11 flex-col items-center justify-between rounded-full p-1.5",
          "border border-border bg-card/90 backdrop-blur-md",
          "shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.55)]",
          "transition-shadow duration-300 hover:shadow-[0_14px_36px_-12px_hsl(var(--primary)/0.75)]"
        )}
      >
        {/* The knob that slides between the two icons. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-1.5 h-8 w-8 rounded-full bg-primary/15 ring-1 ring-primary/40",
            "transition-all duration-500 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]",
            isDark ? "top-[calc(100%-2.375rem)]" : "top-1.5"
          )}
        />

        <span
          aria-hidden="true"
          className={cn(
            "relative z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-300",
            isDark ? "text-muted-foreground" : "text-primary"
          )}
        >
          <Sun
            className={cn(
              "h-4 w-4 transition-transform duration-500",
              isDark ? "rotate-0 scale-90" : "rotate-90 scale-110"
            )}
          />
        </span>

        <span
          aria-hidden="true"
          className={cn(
            "relative z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-300",
            isDark ? "text-primary" : "text-muted-foreground"
          )}
        >
          <Moon
            className={cn(
              "h-4 w-4 transition-transform duration-500",
              isDark ? "-rotate-12 scale-110" : "rotate-0 scale-90"
            )}
          />
        </span>
      </button>
    </div>
  )
}
