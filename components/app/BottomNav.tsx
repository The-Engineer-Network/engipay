"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Receipt, QrCode, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

const LEFT = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/activity", label: "Activity", icon: Receipt },
] as const

const RIGHT = [{ href: "/settings", label: "Settings", icon: Settings }] as const

/**
 * Phone navigation. Scanning sits in the middle as a raised button because it
 * is the action people reach for while standing in front of someone else.
 * Hidden on desktop, where the top navigation does the job.
 */
export function BottomNav() {
  const pathname = usePathname()

  const item = (href: string, label: string, Icon: typeof Home) => {
    const active = pathname === href
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] transition-colors",
          active ? "text-primary" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
        {label}
      </Link>
    )
  }

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md items-center px-2">
        {LEFT.map(({ href, label, icon }) => item(href, label, icon))}

        <Link
          href="/scan"
          aria-label="Scan to pay"
          className="relative -mt-6 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_30px_-8px_hsl(var(--primary)/0.8)] transition-transform active:scale-95"
        >
          <QrCode className="h-6 w-6" aria-hidden="true" />
        </Link>

        {RIGHT.map(({ href, label, icon }) => item(href, label, icon))}
        {/* Balances the row so the raised button stays centred. */}
        <span className="flex-1" aria-hidden="true" />
      </div>
    </nav>
  )
}
