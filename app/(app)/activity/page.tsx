"use client"

import { PageHeader } from "@/components/app/PageHeader"
import { PendingServiceNote } from "@/components/app/PendingServiceNote"
import { Card, CardContent } from "@/components/ui/card"
import { Receipt } from "lucide-react"

export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Activity"
        description="Every payment, conversion and Naira transfer in one list."
      />

      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Receipt className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="font-medium">No activity yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Once you send, receive or convert, it shows up here with its status and a link to the
            block explorer.
          </p>
        </CardContent>
      </Card>

      <div className="mt-6">
        <PendingServiceNote>
          History needs the backend to index transactions. Until it exists, this list stays empty
          rather than showing made-up entries.
        </PendingServiceNote>
      </div>
    </div>
  )
}
