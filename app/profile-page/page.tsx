"use client"

import '@/styles/profile-page.css'
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/contexts/WalletContext"
import dynamic from "next/dynamic"
import { ArrowLeft, TrendingUp, Wallet, Settings, Award, PieChart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

// Dynamically import heavy components
const PortfolioOverview = dynamic(() => import("@/components/defi/portfolio-overview").then(mod => ({ default: mod.PortfolioOverview })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const LendingBorrowing = dynamic(() => import("@/components/defi/lending-borrowing").then(mod => ({ default: mod.LendingBorrowing })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const YieldFarming = dynamic(() => import("@/components/defi/yield-farming").then(mod => ({ default: mod.YieldFarming })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const ClaimRewards = dynamic(() => import("@/components/defi/claim-rewards").then(mod => ({ default: mod.ClaimRewards })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const ProfileSettings = dynamic(() => import("@/components/defi/profile-settings").then(mod => ({ default: mod.ProfileSettings })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState("portfolio")
  const router = useRouter()
  const { isConnected } = useWallet()

  useEffect(() => {
    const savedWallet = localStorage.getItem("engipay-wallet")
    if (!isConnected && !savedWallet) {
      router.push('/')
    }
  }, [isConnected, router])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
              {/* Assuming route to dashboard is /dashboard */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 hover:bg-transparent cursor-pointer group transition-colors"
                >
                  <ArrowLeft className="h-4 w-4 group-hover:text-primary transition-colors" />
                  <span className="group-hover:text-primary transition-colors">Dashboard</span>
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-balance">DeFi & Profile</h1>
                <p className="text-sm text-muted-foreground">Manage your decentralized finance positions</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                EngiPay
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Content of the main page */}
      <div className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="grid w-full grid-cols-5 lg:w-fit lg:grid-cols-5 bg-secondary/50">
            <TabsTrigger
              value="portfolio"
              className="gap-2 cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
            >
              <PieChart className="h-4 w-4" />
              <span className="hidden sm:inline">Portfolio</span>
            </TabsTrigger>
            <TabsTrigger
              value="lending"
              className="gap-2 cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
            >
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">Lending</span>
            </TabsTrigger>
            <TabsTrigger
              value="farming"
              className="gap-2 cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
            >
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">Farming</span>
            </TabsTrigger>
            <TabsTrigger
              value="rewards"
              className="gap-2 cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
            >
              <Award className="h-4 w-4" />
              <span className="hidden sm:inline">Rewards</span>
            </TabsTrigger>
            <TabsTrigger
              value="profile"
              className="gap-2 cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Profile</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="portfolio" className="space-y-6">
            <PortfolioOverview />
          </TabsContent>

          <TabsContent value="lending" className="space-y-6">
            <LendingBorrowing />
          </TabsContent>

          <TabsContent value="farming" className="space-y-6">
            <YieldFarming />
          </TabsContent>

          <TabsContent value="rewards" className="space-y-6">
            <ClaimRewards />
          </TabsContent>

          <TabsContent value="profile" className="space-y-6">
            <ProfileSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
