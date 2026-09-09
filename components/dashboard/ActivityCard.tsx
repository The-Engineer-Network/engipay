"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ArrowUpRight,
  ArrowLeftRight,
  ArrowDownLeft,
  Target,
  Zap,
  Activity as ActivityIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Activity } from "@/types/dashboard"

interface ActivityCardProps {
  activities: Activity[]
}

const TYPE_ICON = {
  payment: ArrowUpRight,
  swap: ArrowLeftRight,
  lending: Target,
  staking: Zap,
  airdrop: ArrowDownLeft,
} as const

const STATUS_STYLE: Record<Activity["status"], string> = {
  completed: "border-primary/40 bg-primary/15 text-primary",
  active: "border-border bg-muted text-foreground",
  pending: "border-warning/40 bg-warning/15 text-warning",
}

function amountTone(amount: string) {
  if (amount.startsWith("+")) return "text-success"
  if (amount.startsWith("-")) return "text-destructive"
  return "text-foreground"
}

export function ActivityCard({ activities }: ActivityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <div className="py-10 text-center">
            <ActivityIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No activity yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your payments and swaps will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activities.map((activity) => {
              const Icon = TYPE_ICON[activity.type] ?? ActivityIcon
              return (
                <li key={activity.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{activity.description}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{activity.time}</span>
                      {activity.network && (
                        <Badge variant="outline" className="text-[10px]">
                          {activity.network}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className={cn("text-sm font-medium tabular-nums", amountTone(activity.amount))}>
                      {activity.amount}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn("mt-1 text-[10px] capitalize", STATUS_STYLE[activity.status])}
                    >
                      {activity.status}
                    </Badge>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
