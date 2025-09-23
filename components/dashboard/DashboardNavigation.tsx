"use client"

import Link from "next/link"
import { Wallet, TrendingUp, Target } from "lucide-react"
import { TabType } from "@/types/dashboard"

interface DashboardNavigationProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
}

export function DashboardNavigation({ activeTab, onTabChange }: DashboardNavigationProps) {
  const tabs: { id: TabType; label: string; icon: React.ReactNode; isLink: boolean }[] = [
    { id: "overview", label: "Overview", icon: <Wallet className="w-4 h-4" />, isLink: false },
    { id: "payment", label: "Payment & Swap", icon: <TrendingUp className="w-4 h-4" />, isLink: false },
  ]

  const links = [
    { href: "/defi", label: "DeFi & Profile", icon: <Target className="w-4 h-4" /> },
  ]

  return (
    <nav style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
      <div className="container mx-auto px-4">
        <div className="flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id as TabType)}
              className="flex items-center space-x-2 py-4 px-2 font-medium transition-colors"
              style={{
                borderBottom: activeTab === tab.id ? '2px solid #00d084' : '2px solid transparent',
                color: activeTab === tab.id ? '#00d084' : 'rgba(255, 255, 255, 0.7)',
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = '#ffffff'
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
                }
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center space-x-2 py-4 px-2 font-medium transition-colors"
              style={{
                color: 'rgba(255, 255, 255, 0.7)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#ffffff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
              }}
            >
              {link.icon}
              <span>{link.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}