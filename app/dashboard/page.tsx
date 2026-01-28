"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/contexts/WalletContext"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import { BalanceCard } from "@/components/dashboard/BalanceCard"
import { QuickActions } from "@/components/dashboard/QuickActions"
import { ActivityCard } from "@/components/dashboard/ActivityCard"
import { DeFiCard } from "@/components/dashboard/DeFiCard"
import { mockRecentActivity, mockDeFiOpportunities } from "@/data/dashboardData"
import { TabType } from "@/types/dashboard"

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabType>("overview")
  const router = useRouter()
  const { isConnected, balances, isLoadingBalances } = useWallet()

  useEffect(() => {
    const savedWallet = localStorage.getItem("engipay-wallet")
    if (!isConnected && !savedWallet) {
      router.push('/')
    }
  }, [isConnected, router])

  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }


  const handleQuickAction = (action: string) => {
    console.log(`Quick action: ${action}`)
    // Handle quick actions here
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    // Handle navigation between pages
    if (tab === "payments") {
      router.push('/payments-swaps')
    } else if (tab === "defi") {
      router.push('/defi')
    }
  }



  return (
    <div className="min-h-screen text-white"
      style={{
        background: '#0a0a0a',
        color: '#ffffff'
      }}
    >

      <DashboardHeader />
      <DashboardNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Portfolio Performance Header */}
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 space-y-4 lg:space-y-0">
            <div className="text-center lg:text-left">
              <h2 className="text-2xl sm:text-3xl font-bold mb-2">Portfolio Dashboard</h2>
              <p className="text-sm sm:text-base text-gray-400">Real-time DeFi performance & analytics</p>
            </div>
            <div className="flex items-center justify-center lg:justify-end space-x-4">
              <div className="text-center lg:text-right">
                <div className="text-xl sm:text-2xl font-bold text-green-400">
                  {isLoadingBalances ? '...' : `$${balances.reduce((total, asset) => total + parseFloat(asset.value.replace('$', '')), 0).toFixed(2)}`}
                </div>
                <div className="text-xs sm:text-sm text-gray-400">Total Portfolio Value</div>
              </div>
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center animate-pulse">
                <span className="text-lg sm:text-2xl">📈</span>
              </div>
            </div>
          </div>
        </div>

        {/* Balance Overview */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 space-y-3 sm:space-y-0">
            <div className="flex items-center justify-center sm:justify-start space-x-3">
              <h3 className="text-xl sm:text-2xl font-bold">Balance Overview</h3>
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
            <div className="text-center sm:text-right">
              <p className="text-sm text-gray-400">{balances.length} assets • {isLoadingBalances ? 'Loading...' : 'Real-time'}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4 sm:gap-6">
            {isLoadingBalances ? (
              // Loading skeleton
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="w-full">
                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 animate-pulse">
                    <div className="flex items-center justify-between mb-2">
                      <div className="h-4 bg-gray-700 rounded w-16"></div>
                      <div className="h-6 bg-gray-700 rounded w-6"></div>
                    </div>
                    <div className="h-6 bg-gray-700 rounded w-20 mb-1"></div>
                    <div className="h-4 bg-gray-700 rounded w-16"></div>
                  </div>
                </div>
              ))
            ) : balances.length > 0 ? (
              balances.map((asset, index) => (
                <div key={asset.symbol} style={{ animationDelay: `${index * 0.1}s` }} className="w-full">
                  <BalanceCard
                    symbol={asset.symbol}
                    name={asset.name}
                    balance={asset.balance}
                    value={asset.value}
                    change={asset.change}
                    icon={asset.icon}
                    trend={asset.trend}
                    volume={asset.volume}
                  />
                </div>
              ))
            ) : (
              // No balances message
              <div className="col-span-full text-center py-8">
                <div className="text-gray-400 text-lg">No token balances found</div>
                <div className="text-gray-500 text-sm mt-2">Connect your wallet to view your assets</div>
              </div>
            )}
          </div>
        </div>

        <QuickActions onAction={handleQuickAction} />

        <div className="grid lg:grid-cols-2 gap-8">
          <ActivityCard activities={mockRecentActivity} />
          <DeFiCard opportunities={mockDeFiOpportunities} />
        </div>

        {/* Additional Stats Section */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-xl p-4 sm:p-6 hover:scale-105 transition-all duration-300">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h4 className="text-sm sm:text-lg font-semibold text-green-400">Total Value</h4>
                <p className="text-xl sm:text-2xl font-bold">
                  {isLoadingBalances ? '...' : `$${balances.reduce((total, asset) => total + parseFloat(asset.value.replace('$', '')), 0).toFixed(2)}`}
                </p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-500/20 rounded-full flex items-center justify-center ml-4">
                <span className="text-lg sm:text-2xl">💰</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-xl p-4 sm:p-6 hover:scale-105 transition-all duration-300">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h4 className="text-sm sm:text-lg font-semibold text-blue-400">Active Positions</h4>
                <p className="text-xl sm:text-2xl font-bold">12</p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-500/20 rounded-full flex items-center justify-center ml-4">
                <span className="text-lg sm:text-2xl">🎯</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl p-4 sm:p-6 hover:scale-105 transition-all duration-300 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h4 className="text-sm sm:text-lg font-semibold text-purple-400">Avg. APY</h4>
                <p className="text-xl sm:text-2xl font-bold">14.2%</p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-500/20 rounded-full flex items-center justify-center ml-4">
                <span className="text-lg sm:text-2xl">⚡</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}