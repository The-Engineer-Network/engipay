"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/contexts/WalletContext"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import { TabType } from "@/types/dashboard"

// Dynamically import heavy components
const PortfolioOverview = dynamic(() => import("@/components/defi/portfolio-overview").then(mod => ({ default: mod.PortfolioOverview })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const YieldFarming = dynamic(() => import("@/components/defi/yield-farming").then(mod => ({ default: mod.YieldFarming })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const LendingBorrowing = dynamic(() => import("@/components/defi/lending-borrowing").then(mod => ({ default: mod.LendingBorrowing })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const ClaimRewards = dynamic(() => import("@/components/defi/claim-rewards").then(mod => ({ default: mod.ClaimRewards })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const ProfileSettings = dynamic(() => import("@/components/defi/profile-settings").then(mod => ({ default: mod.ProfileSettings })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})

export default function DeFiPage() {
  const [activeTab, setActiveTab] = useState<TabType>("defi")
  const [defiSubTab, setDefiSubTab] = useState("portfolio")
  const router = useRouter()
  const { isConnected } = useWallet()

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