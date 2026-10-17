"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { sanitizeAmount } from "@/lib/amountInput"

interface AmountInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode"> {
  /** The amount as a decimal string. */
  value: string
  /** Receives a cleaned decimal string, never a number. */
  onValueChange: (value: string) => void
  /** Decimal places the asset allows; extra digits are dropped as they are typed. */
  decimals: number
}

/**
 * The one amount field: decimal keyboard, digits and a single separator only,
 * and a decimals limit taken from the asset.
 */
export function AmountInput({ value, onValueChange, decimals, ...props }: AmountInputProps) {
  return (
    <Input
      {...props}
      type="text"
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      autoComplete="off"
      value={value}
      onChange={(event) => onValueChange(sanitizeAmount(event.target.value, decimals))}
    />
  )
}
