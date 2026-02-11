"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/contexts/WalletContext"
import dynamic from "next/dynamic"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import { TabType } from "@/types/dashboard"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Send,
  ArrowLeftRight,
  QrCode,
  Building2,
  Zap,
  Bitcoin,
  Clock,
  Filter,
  Calendar,
  DollarSign,
} from "lucide-react"
import { toast } from "@/hooks/use-toast"

// Dynamically import heavy components
const ServicePurchase = dynamic(() => import("@/components/payments/ServicePurchase").then(mod => ({ default: mod.ServicePurchase })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const BtcSwap = dynamic(() => import("@/components/payments/BtcSwap").then(mod => ({ default: mod.BtcSwap })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-64 rounded-lg" />
})
const PaymentModals = dynamic(() => import("@/components/payments/PaymentModals").then(mod => ({ default: mod.PaymentModals })), {
  ssr: false
})
const TransactionHistory = dynamic(() => import("@/components/payments/TransactionHistory").then(mod => ({ default: mod.TransactionHistory })), {
  loading: () => <div className="animate-pulse bg-gray-800 h-96 rounded-lg" />
})

export default function PaymentsSwapsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("payments")
  const [activeModal, setActiveModal] = useState<'send' | 'request' | 'qr' | 'merchant' | null>(null)
  const router = useRouter()
  const { isConnected } = useWallet()

  useEffect(() => {
    const savedWallet = localStorage.getItem("engipay-wallet")
    if (!isConnected && !savedWallet) {
      router.push('/')
    }
  }, [isConnected, router])

  // Show loading only briefly
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
    // Handle navigation for overview tab
    if (tab === "overview") {
      router.push('/dashboard')
    }
  }

  const paymentOptions = [
    {
      icon: <Send className="w-6 h-6" />,
      title: "Send Payment",
      description: "Transfer funds to another wallet",
      action: () => setActiveModal('send'),
    },
    {
      icon: <ArrowLeftRight className="w-6 h-6" />,
      title: "Request Payment",
      description: "Ask for payment from contacts",
      action: () => setActiveModal('request'),
    },
    {
      icon: <QrCode className="w-6 h-6" />,
      title: "Scan QR",
      description: "Scan QR code to pay",
      action: () => setActiveModal('qr'),
    },
    {
      icon: <Building2 className="w-6 h-6" />,
      title: "Merchant Payments",
      description: "Pay merchants wallet-to-wallet",
      action: () => setActiveModal('merchant'),
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Chipi Pay",
      description: "Powered by Chipi Pay SDK",
      action: () => {
        // Scroll to ChipiPay section
        document.getElementById('chipipay-section')?.scrollIntoView({ behavior: 'smooth' })
      },
      isSdk: true,
    },
  ]

  const tokens = [
    { symbol: "BTC", name: "Bitcoin" },
    { symbol: "ETH", name: "Ethereum" },
    { symbol: "STRK", name: "Starknet" },
  ]

  const handleQuickPayment = (type: string) => {
    console.log(`Payment action: ${type}`)
    // Payment actions are handled by the modal system
  }

  return (
    // Main Container
    <div className="min-h-screen bg-black text-foreground">
      {/* Floating Orbs */}
      <div className="glow-orb w-32 h-32 bg-gradient-to-r from-primary/30 to-secondary/30 top-20 left-10" />
      <div className="glow-orb w-24 h-24 bg-gradient-to-r from-secondary/20 to-accent/20 top-40 right-20" />

      <DashboardHeader />
      <DashboardNavigation activeTab={activeTab} onTabChange={handleTabChange} />
      
      {/* Page Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl md:text-2xl font-bold mb-4">Payments & Swaps</h1>
          <p className="text-xl text-muted-foreground">Manage your transactions and cross-chain swaps</p>
        </div>

        {/* Payments Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <DollarSign className="w-8 h-8 text-primary" />
            Payments
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paymentOptions.map((option, index) => (
              <Card key={index} className="glassmorphism hover:scale-105 transition-all duration-300 group cursor-pointer">
                <CardContent className="p-6 text-center">
                  <div className={`text-primary mb-4 flex justify-center group-hover:scale-110 transition-transform ${option.isSdk ? 'text-cyan-500' : ''}`}>
                    {option.icon}
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{option.title}</h3>
                  <p className="text-muted-foreground text-sm mb-4">{option.description}</p>
                  <Button
                    className="glow-button bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                    onClick={option.action}
                  >
                    {option.title}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Bitcoin Operations Section */}
        {/* Removed for performance - will be added back with optimization */}

        {/* Chipi Pay Service Purchase */}
        <section className="mb-12" id="chipipay-section">
          <ServicePurchase />
        </section>

        {/* Cross-Chain Swaps Section */}
        <section className="mb-12">
          <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
            <ArrowLeftRight className="w-8 h-8 text-primary" />
            Cross-Chain Swaps
          </h2>
          <BtcSwap />
        </section>

        {/* Transaction History */}
        <section>
          <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
            <Clock className="w-8 h-8 text-primary" />
            Transaction History
          </h2>
          <TransactionHistory />
        </section>

        {/* Payment Modals */}
        <PaymentModals activeModal={activeModal} onClose={() => setActiveModal(null)} />
      </div>
    </div>
  )
}