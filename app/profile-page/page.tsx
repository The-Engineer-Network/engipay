"use client"

import '@/styles/profile-page.css'
import { useState } from "react"
import { ArrowLeft, TrendingUp, Wallet, Settings, Award, PieChart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { PortfolioOverview } from "@/components/defi/portfolio-overview"
import { LendingBorrowing } from "@/components/defi/lending-borrowing"
import { YieldFarming } from "@/components/defi/yield-farming"
import { ClaimRewards } from "@/components/defi/claim-rewards"
import { ProfileSettings } from "@/components/defi/profile-settings"

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState("portfolio")

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
