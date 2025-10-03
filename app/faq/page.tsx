"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft, Plus, Minus } from "lucide-react"
import Link from "next/link"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { WalletConnectModal } from "@/components/WalletConnectModal"
import { LovelyLoader } from "@/components/ui/loader"

export default function FAQPage() {
  const router = useRouter()
  const [openItems, setOpenItems] = useState<number[]>([])
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Simulate initial loading
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 500)

    return () => clearTimeout(timer)
  }, [])

  const toggleItem = (index: number) => {
    setOpenItems((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]))
  }

  const faqs = [
    {
      question: "What is EngiPay?",
      answer:
        "EngiPay is a next-generation Web3 super app that combines everyday payments with powerful DeFi tools. You can send money, swap tokens across chains, and access lending, borrowing, and yield farming - all in one wallet-native experience.",
    },
    {
      question: "How does cross-chain swapping work?",
      answer:
        "Our Atomiq SDK integration enables seamless token swaps between Bitcoin, Ethereum, and StarkNet networks. You can easily convert BTC to ETH or STRK tokens without needing multiple wallets or complex bridge protocols.",
    },
    {
      question: "Is EngiPay secure?",
      answer:
        "Yes, EngiPay is built on StarkNet's zero-knowledge rollup technology and uses enterprise-grade security protocols. Your funds remain in your wallet at all times, and we never have access to your private keys.",
    },
    {
      question: "What wallets are supported?",
      answer:
        "EngiPay supports major Web3 wallets including MetaMask, Argent, and Xverse for Bitcoin. We're continuously adding support for more wallets to ensure maximum compatibility.",
    },
    {
      question: "Are there any fees?",
      answer:
        "EngiPay charges minimal network fees for transactions. P2P payments are free, and cross-chain swaps have competitive rates. All fees are transparently displayed before you confirm any transaction.",
    },
    {
      question: "How do I get started?",
      answer:
        "Simply connect your Web3 wallet to EngiPay and you're ready to go! No lengthy onboarding process or KYC requirements. Start sending, swapping, and earning immediately.",
    },
    {
      question: "What DeFi features are available?",
      answer:
        "EngiPay offers lending, borrowing, yield farming, and staking opportunities across multiple protocols. Earn passive income on your crypto holdings while maintaining full control of your assets.",
    },
    {
      question: "Is EngiPay available globally?",
      answer:
        "Yes, EngiPay is available worldwide. As a decentralized application, you can access all features from anywhere with an internet connection, subject to your local regulations.",
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
          <h1 className="text-5xl md:text-6xl font-bold mb-6 text-black">Frequently Asked Questions</h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Find answers to common questions about EngiPay's features, security, and how to get started
          </p>
        </div>

        <div className="max-w-4xl mx-auto space-y-4">
          {faqs.map((faq, index) => (
            <Card key={index} className="glassmorphism">
              <CardContent className="p-0">
                <button
                  onClick={() => toggleItem(index)}
                  className="w-full p-6 text-left flex items-center justify-between hover:bg-white/5 transition-colors"
                >
                  <h3 className="text-lg font-semibold text-white">{faq.question}</h3>
                  {openItems.includes(index) ? (
                    <Minus className="w-5 h-5 text-purple-500" />
                  ) : (
                    <Plus className="w-5 h-5 text-purple-500" />
                  )}
                </button>
                {openItems.includes(index) && (
                  <div className="px-6 pb-6">
                    <p className="text-muted-foreground leading-relaxed">{faq.answer}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

      </div>
    </div>
  )
}
