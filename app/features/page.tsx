"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Zap, ArrowRightLeft, Bitcoin, TrendingUp, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { WalletConnectModal } from "@/components/WalletConnectModal"
import { LovelyLoader } from "@/components/ui/loader"

export default function FeaturesPage() {
  const router = useRouter()
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Simulate initial loading
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 1500)

    return () => clearTimeout(timer)
  }, [])
  const features = [
    {
      icon: <Zap className="w-12 h-12" />,
      title: "Instant Payments",
      description: "P2P & Merchant payments powered by Chipi-Pay SDK",
      details:
        "Send money to friends or pay merchants instantly with zero fees. Our Chipi-Pay SDK integration ensures lightning-fast transactions across multiple networks.",
    },
    {
      icon: <ArrowRightLeft className="w-12 h-12" />,
      title: "Cross-Chain Swaps",
      description: "Seamlessly swap BTC ↔ STRK/ETH via Atomiq SDK",
      details:
        "Trade between Bitcoin, Ethereum, and StarkNet tokens with our advanced cross-chain technology. No need for multiple wallets or complex bridges.",
    },
    {
      icon: <Bitcoin className="w-12 h-12" />,
      title: "Bitcoin Ready",
      description: "Accept and send Bitcoin directly via Xverse Wallet API",
      details:
        "Full Bitcoin integration with native wallet support. Send, receive, and manage your Bitcoin alongside other crypto assets in one unified interface.",
    },
    {
      icon: <TrendingUp className="w-12 h-12" />,
      title: "DeFi Power Tools",
      description: "Lending, Borrowing, Yield Farming, Staking",
      details:
        "Access the full DeFi ecosystem with lending protocols, yield farming opportunities, and staking rewards. Maximize your crypto earnings with professional-grade tools.",
    },
  ]

  return (
    <div className="min-h-screen cosmic-bg text-foreground">
      <WalletConnectModal open={showWalletModal} onOpenChange={setShowWalletModal} />

      {/* Lovely Loader Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-500">
          <div className="text-center animate-in slide-in-from-bottom-4 duration-700 delay-200">
            <LovelyLoader size="lg" className="mb-4" />
            <p className="text-white text-lg font-medium animate-in slide-in-from-bottom-2 duration-500 delay-300">Loading...</p>
          </div>
        </div>
      )}

      {/* Purple Circular Home Button */}
      <Link href="/">
        <button
          className="fixed top-6 left-6 z-50 w-14 h-14 bg-purple-600 hover:bg-purple-700 text-white rounded-full flex items-center justify-center shadow-lg transition-all duration-300 hover:scale-110"
          title="Back to Home"
          aria-label="Back to Home"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
      </Link>

      <div className="container mx-auto px-4 py-20">

        <div className="text-center mb-16">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 text-black">EngiPay Features</h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Discover the powerful features that make EngiPay the ultimate Web3 payments and DeFi platform
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-6xl mx-auto">
          {features.map((feature, index) => (
            <Card key={index} className="glassmorphism hover:scale-105 transition-all duration-300 group">
              <CardContent className="p-8">
                <div className="text-primary mb-6 flex justify-center group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <h3 className="text-2xl font-semibold mb-4 text-center">{feature.title}</h3>
                <p className="text-muted-foreground text-center mb-4">{feature.description}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.details}</p>
              </CardContent>
            </Card>
          ))}
        </div>

      </div>
    </div>
  )
}
