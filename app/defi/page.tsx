"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/contexts/WalletContext"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import { TabType } from "@/types/dashboard"
import { PortfolioOverview } from "@/components/defi/portfolio-overview"
import { YieldFarming } from "@/components/defi/yield-farming"
import { LendingBorrowing } from "@/components/defi/lending-borrowing"
import { ClaimRewards } from "@/components/defi/claim-rewards"
import { ProfileSettings } from "@/components/defi/profile-settings"

export default function DeFiPage() {
  const [activeTab, setActiveTab] = useState<TabType>("defi")
  const [defiSubTab, setDefiSubTab] = useState("portfolio")
  const [isClient, setIsClient] = useState(false)
  const router = useRouter()
  const { isConnected } = useWallet()

  useEffect(() => {
    // Set client flag to prevent hydration issues
    setIsClient(true)

    // Only check localStorage on client side to prevent hydration mismatch
    if (typeof window !== 'undefined') {
      const savedWallet = localStorage.getItem("engipay-wallet")
      const hasWalletConnection = isConnected || savedWallet

      if (!hasWalletConnection) {
        router.push('/')
        return
      }
    }
  }, [isConnected, router])

  // Prevent hydration mismatch by not rendering until client-side
  if (!isClient) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading...</p>
        </div>
      </div>
    )
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    // Handle navigation for overview tab
    if (tab === "overview") {
      router.push('/dashboard')
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

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">DeFi Dashboard</h1>
          <p className="text-gray-400">Manage your decentralized finance positions and earn rewards</p>
        </div>

        <Tabs value={defiSubTab} onValueChange={setDefiSubTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5 bg-gray-800">
            <TabsTrigger value="portfolio" className="data-[state=active]:bg-green-600">Portfolio</TabsTrigger>
            <TabsTrigger value="farming" className="data-[state=active]:bg-green-600">Yield Farming</TabsTrigger>
            <TabsTrigger value="lending" className="data-[state=active]:bg-green-600">Lending</TabsTrigger>
            <TabsTrigger value="rewards" className="data-[state=active]:bg-green-600">Rewards</TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-green-600">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="portfolio" className="mt-6">
            <PortfolioOverview />
          </TabsContent>

          <TabsContent value="farming" className="mt-6">
            <YieldFarming />
          </TabsContent>

          <TabsContent value="lending" className="mt-6">
            <LendingBorrowing />
          </TabsContent>

          <TabsContent value="rewards" className="mt-6">
            <ClaimRewards />
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <ProfileSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}