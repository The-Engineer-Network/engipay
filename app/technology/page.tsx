"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Shield, Zap, Globe, Lock } from "lucide-react"
import Link from "next/link"
import { WalletConnectModal } from "@/components/WalletConnectModal"
import { LovelyLoader } from "@/components/ui/loader"

export default function TechnologyPage() {
  const router = useRouter()
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Simulate initial loading
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 500)

    return () => clearTimeout(timer)
  }, [])
  const techStack = [
    {
      icon: <Shield className="w-8 h-8" />,
      title: "StarkNet Integration",
      description: "Built on StarkNet's zero-knowledge rollup technology for maximum security and scalability",
    },
    {
      icon: <Zap className="w-8 h-8" />,
      title: "Chipi-Pay SDK",
      description: "Lightning-fast payment processing with instant settlement and minimal fees",
    },
    {
      icon: <Globe className="w-8 h-8" />,
      title: "Atomiq Cross-Chain",
      description: "Seamless asset bridging across Bitcoin, Ethereum, and StarkNet networks",
    },
    {
      icon: <Lock className="w-8 h-8" />,
      title: "Xverse Wallet API",
      description: "Native Bitcoin wallet integration with enterprise-grade security",
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
          <Badge className="mb-6 bg-purple-500/20 text-black border-purple-500/30 font-semibold">
            Cutting-Edge Technology
          </Badge>
          <h1 className="text-5xl md:text-6xl font-bold mb-6 text-black">Technology Stack</h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            EngiPay is built on the most advanced Web3 technologies, ensuring security, scalability, and seamless user
            experience
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-16">
          {techStack.map((tech, index) => (
            <Card key={index} className="glassmorphism hover:scale-105 transition-all duration-300 group">
              <CardContent className="p-6">
                <div className="text-primary mb-4 group-hover:scale-110 transition-transform">{tech.icon}</div>
                <h3 className="text-xl font-semibold mb-3">{tech.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{tech.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="max-w-4xl mx-auto">
          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-3xl font-bold mb-6 text-center">Why Our Technology Matters</h2>
              <div className="grid md:grid-cols-3 gap-6 text-center">
                <div>
                  <h3 className="text-xl font-semibold mb-2 text-primary">Security First</h3>
                  <p className="text-muted-foreground text-sm">
                    Zero-knowledge proofs and multi-layer security protocols
                  </p>
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2 text-primary">Lightning Fast</h3>
                  <p className="text-muted-foreground text-sm">Sub-second transaction processing with minimal fees</p>
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2 text-primary">Cross-Chain</h3>
                  <p className="text-muted-foreground text-sm">
                    Seamless interoperability across major blockchain networks
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
