"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Receipt, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The three places you can always get back to. The money actions - send,
 * receive, scan, convert, buy, sell - are reached from the home screen tiles,
 * which keeps this bar short enough for a phone.
 */
const LINKS = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/activity", label: "Activity", icon: Receipt },
  { href: "/settings", label: "Settings", icon: Settings },
] as const

export function AppNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      className="hidden border-b border-border bg-background/80 backdrop-blur md:block"
    >
      <div className="container">
        <ul className="-mb-px flex gap-1">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3.5 text-sm font-medium transition-colors",
                    "hover:text-foreground focus-visible:outline-none",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
