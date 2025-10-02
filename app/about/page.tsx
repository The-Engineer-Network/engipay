"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft, Users, Target, Rocket } from "lucide-react"
import Link from "next/link"
import { WalletConnectModal } from "@/components/WalletConnectModal"
import { LovelyLoader } from "@/components/ui/loader"

export default function AboutPage() {
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

  const values = [
    {
      icon: <Users className="w-8 h-8" />,
      title: "User-Centric",
      description: "Every feature is designed with our users' needs and experience at the forefront",
    },
    {
      icon: <Target className="w-8 h-8" />,
      title: "Innovation",
      description: "Pushing the boundaries of what's possible in Web3 payments and DeFi",
    },
    {
      icon: <Rocket className="w-8 h-8" />,
      title: "Accessibility",
      description: "Making advanced financial tools accessible to everyone, regardless of technical expertise",
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
          <h1 className="text-5xl md:text-6xl font-bold mb-6 text-black">About EngiPay</h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            We're building the future of payments by bridging traditional finance with the power of Web3 and DeFi
          </p>
        </div>

        <div className="max-w-4xl mx-auto mb-16">
          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-3xl font-bold mb-6 text-center">Our Mission</h2>
              <p className="text-lg text-muted-foreground leading-relaxed text-center mb-6">
                EngiPay exists to democratize access to advanced financial tools by creating a seamless bridge between
                everyday payments and the powerful world of decentralized finance. We believe that everyone should have
                access to the same financial opportunities, regardless of their technical background or geographic
                location.
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed text-center">
                Our platform combines the simplicity of traditional payment apps with the innovation of Web3 technology,
                creating a super app that empowers users to send, swap, and earn with their digital assets.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto mb-16">
          {values.map((value, index) => (
            <Card key={index} className="glassmorphism hover:scale-105 transition-all duration-300 group">
              <CardContent className="p-6 text-center">
                <div className="text-primary mb-4 flex justify-center group-hover:scale-110 transition-transform">
                  {value.icon}
                </div>
                <h3 className="text-xl font-semibold mb-3">{value.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{value.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="max-w-4xl mx-auto">
          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-3xl font-bold mb-6 text-center">The Team</h2>
              <p className="text-lg text-muted-foreground leading-relaxed text-center">
                EngiPay is built by a team of experienced developers, designers, and financial experts who are
                passionate about creating the next generation of financial tools. With backgrounds spanning traditional
                fintech, blockchain development, and user experience design, we bring together the best of all worlds to
                create something truly revolutionary.
              </p>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
