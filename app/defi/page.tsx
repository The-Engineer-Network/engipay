"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/contexts/WalletContext"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import { TabType } from "@/types/dashboard"

const PanelSkeleton = () => (
  <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
)

// Lending, yield farming and staking rewards are withheld from this release.
// Their components remain in components/defi/ so they can be restored.
const PortfolioOverview = dynamic(
  () => import("@/components/defi/portfolio-overview").then((mod) => ({ default: mod.PortfolioOverview })),
  { loading: PanelSkeleton }
)
const ProfileSettings = dynamic(
  () => import("@/components/defi/profile-settings").then((mod) => ({ default: mod.ProfileSettings })),
  { loading: PanelSkeleton }
)

export default function PortfolioPage() {
  const [activeTab, setActiveTab] = useState<TabType>("defi")
  const [subTab, setSubTab] = useState("portfolio")
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const { isConnected } = useWallet()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const savedWallet = localStorage.getItem("engipay-wallet")
    if (!isConnected && !savedWallet) router.push("/")
  }, [mounted, isConnected, router])

  if (!mounted) return null

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    if (tab === "overview") router.push("/dashboard")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DashboardHeader />
      <DashboardNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="container py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Portfolio</h1>
          <p className="mt-1 text-muted-foreground">
            Track your holdings and manage your account settings.
          </p>
        </header>

        <Tabs value={subTab} onValueChange={setSubTab} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="portfolio">Holdings</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="portfolio" className="mt-6">
            <PortfolioOverview />
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <ProfileSettings />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
