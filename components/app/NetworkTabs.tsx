"use client"

import { useRef } from "react"
import type { KeyboardEvent } from "react"
import { cn } from "@/lib/utils"

export interface NetworkTabOption<T extends string> {
  value: T
  label: string
}

interface NetworkTabsProps<T extends string> {
  options: readonly NetworkTabOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Prefix for the tab and panel ids; see networkTabId and networkPanelId. */
  idPrefix: string
  className?: string
}

export const networkTabId = (prefix: string, value: string) => `${prefix}-tab-${value}`
export const networkPanelId = (prefix: string, value: string) => `${prefix}-panel-${value}`

/**
 * A network switcher that follows the ARIA tabs pattern: roving tabindex,
 * Left, Right, Home and End keys, and each tab linked to its panel.
 */
export function NetworkTabs<T extends string>({
  options,
  value,
  onChange,
  idPrefix,
  className,
}: NetworkTabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1
    let next = index
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = last
    else return
    event.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className={className} role="tablist" aria-label="Network">
      {options.map((option, index) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            id={networkTabId(idPrefix, option.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={networkPanelId(idPrefix, option.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
