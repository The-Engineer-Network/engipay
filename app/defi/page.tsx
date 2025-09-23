"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PortfolioOverview } from "@/components/defi/portfolio-overview"
import { YieldFarming } from "@/components/defi/yield-farming"
import { LendingBorrowing } from "@/components/defi/lending-borrowing"
import { ClaimRewards } from "@/components/defi/claim-rewards"
import { ProfileSettings } from "@/components/defi/profile-settings"

export default function DeFiPage() {
  const [activeTab, setActiveTab] = useState("portfolio")

  return (
    <div className="min-h-screen text-white"
      style={{
        background: '#0a0a0a',
        color: '#ffffff'
      }}
    >
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">DeFi Dashboard</h1>
            <p className="text-gray-400">Manage your decentralized finance positions and earn rewards</p>
          </div>
          <Link href="/dashboard">
            <Button variant="outline" className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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