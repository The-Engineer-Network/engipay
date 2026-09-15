import type { ReactNode } from "react"
import { MarketingHeader } from "@/components/marketing/MarketingHeader"
import Footer from "@/components/landing/Footer"

/** Shared chrome for every public page except the landing page itself. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
