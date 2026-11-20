"use client"

import { PageHeader } from "@/components/app/PageHeader"
import { NairaAnchorRamp } from "@/components/naira/NairaAnchorRamp"

export default function SellPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        title="Sell for Naira"
        description="Convert crypto to Naira, paid directly into your Nigerian bank account via Stellar SEP-24 Anchor."
      />

      <NairaAnchorRamp defaultTab="withdraw" />
    </div>
  )
}
