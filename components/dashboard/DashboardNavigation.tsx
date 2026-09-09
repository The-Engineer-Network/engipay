"use client"

import Link from "next/link"
import { Wallet, ArrowLeftRight, PieChart } from "lucide-react"
import { TabType } from "@/types/dashboard"
import { cn } from "@/lib/utils"

interface DashboardNavigationProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
}

const TABS: { id: TabType; label: string; icon: React.ReactNode; href: string }[] = [
  { id: "overview", label: "Overview", icon: <Wallet className="h-4 w-4" />, href: "/dashboard" },
  {
    id: "payments",
    label: "Pay & Swap",
    icon: <ArrowLeftRight className="h-4 w-4" />,
    href: "/payments-swaps",
  },
  { id: "defi", label: "Portfolio", icon: <PieChart className="h-4 w-4" />, href: "/defi" },
]

export function DashboardNavigation({ activeTab }: DashboardNavigationProps) {
  return (
    <nav aria-label="Main" className="border-b border-border bg-background/80 backdrop-blur">
      <div className="container">
        {/* Scrolls rather than wrapping on narrow screens */}
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <li key={tab.id}>
                <Link
                  href={tab.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3.5 text-sm font-medium transition-colors",
                    "hover:text-foreground focus-visible:outline-none",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground"
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
