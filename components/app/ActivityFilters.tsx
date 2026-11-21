"use client"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"

interface ActivityFiltersProps {
  kind: string
  startDate: string
  endDate: string
  onKindChange: (value: string) => void
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
}

export function ActivityFilters({
  kind,
  startDate,
  endDate,
  onKindChange,
  onStartDateChange,
  onEndDateChange,
}: ActivityFiltersProps) {
  const hasFilters = kind || startDate || endDate

  const clearFilters = () => {
    onKindChange("")
    onStartDateChange("")
    onEndDateChange("")
  }

  return (
    <div className="mb-6 space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Filters</h3>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-auto p-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="mr-1 h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Transaction Kind Filter */}
        <div className="space-y-2">
          <Label htmlFor="kind-filter" className="text-xs text-muted-foreground">
            Type
          </Label>
          <Select value={kind} onValueChange={onKindChange}>
            <SelectTrigger id="kind-filter" className="h-9">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All types</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
              <SelectItem value="deposit">Deposit</SelectItem>
              <SelectItem value="withdrawal">Withdrawal</SelectItem>
              <SelectItem value="conversion">Conversion</SelectItem>
              <SelectItem value="payment">Payment</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Start Date Filter */}
        <div className="space-y-2">
          <Label htmlFor="start-date-filter" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="start-date-filter"
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="h-9"
          />
        </div>

        {/* End Date Filter */}
        <div className="space-y-2">
          <Label htmlFor="end-date-filter" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="end-date-filter"
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="h-9"
            min={startDate}
          />
        </div>
      </div>
    </div>
  )
}
