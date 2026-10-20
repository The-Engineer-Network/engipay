import { PosCounter } from "@/components/pos/PosCounter"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "POS Counter | EngiPay",
  description: "Point of Sale QR payment counter with real-time settlement for shops and merchants.",
}

export default function PosPage() {
  return (
    <div className="mx-auto max-w-4xl py-2">
      <PosCounter />
    </div>
  )
}
