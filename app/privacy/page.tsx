"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft, Shield, Eye, Lock, Database } from "lucide-react"
import Link from "next/link"
import { WalletConnectModal } from "@/components/WalletConnectModal"
import { LovelyLoader } from "@/components/ui/loader"

export default function PrivacyPage() {
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

  const privacyPrinciples = [
    {
      icon: <Shield className="w-8 h-8" />,
      title: "Data Protection",
      description: "We never store your private keys or sensitive wallet information on our servers",
    },
    {
      icon: <Eye className="w-8 h-8" />,
      title: "Transparency",
      description: "All data collection practices are clearly disclosed and you maintain full control",
    },
    {
      icon: <Lock className="w-8 h-8" />,
      title: "Encryption",
      description: "All data transmission is encrypted using industry-standard protocols",
    },
    {
      icon: <Database className="w-8 h-8" />,
      title: "Minimal Data",
      description: "We collect only the minimum data necessary to provide our services",
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
          <h1 className="text-5xl md:text-6xl font-bold mb-6 text-black">Privacy Policy</h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Your privacy and security are our top priorities. Learn how we protect your data and respect your privacy.
          </p>
        </div>

        <div className="max-w-4xl mx-auto mb-16">
          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-3xl font-bold mb-6 text-center">Our Privacy Commitment</h2>
              <p className="text-lg text-muted-foreground leading-relaxed text-center mb-6">
                EngiPay is built with privacy by design. As a decentralized application, we prioritize user privacy and 
                data protection. We believe that financial privacy is a fundamental right, and our platform is designed 
                to give you complete control over your data and transactions.
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed text-center">
                This privacy policy explains how we collect, use, and protect your information when you use EngiPay.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-16">
          {privacyPrinciples.map((principle, index) => (
            <Card key={index} className="glassmorphism hover:scale-105 transition-all duration-300 group">
              <CardContent className="p-6 text-center">
                <div className="text-primary mb-4 flex justify-center group-hover:scale-110 transition-transform">
                  {principle.icon}
                </div>
                <h3 className="text-xl font-semibold mb-3">{principle.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{principle.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="max-w-4xl mx-auto space-y-8">
          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold mb-4">Information We Collect</h2>
              <div className="space-y-4 text-muted-foreground">
                <p><strong>Wallet Information:</strong> We collect your wallet address for transaction processing, but never your private keys.</p>
                <p><strong>Transaction Data:</strong> Basic transaction information for portfolio tracking and analytics.</p>
                <p><strong>Usage Analytics:</strong> Anonymous usage data to improve our services and user experience.</p>
                <p><strong>Device Information:</strong> Basic device and browser information for security and optimization.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold mb-4">How We Use Your Information</h2>
              <div className="space-y-4 text-muted-foreground">
                <p><strong>Service Provision:</strong> To provide and maintain our payment and DeFi services.</p>
                <p><strong>Security:</strong> To detect and prevent fraud, abuse, and security threats.</p>
                <p><strong>Analytics:</strong> To understand usage patterns and improve our platform.</p>
                <p><strong>Communication:</strong> To send important updates about your account and our services.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold mb-4">Data Sharing and Disclosure</h2>
              <div className="space-y-4 text-muted-foreground">
                <p>We do not sell, trade, or rent your personal information to third parties. We may share information only in the following circumstances:</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>With your explicit consent</li>
                  <li>To comply with legal obligations</li>
                  <li>To protect our rights and prevent fraud</li>
                  <li>With service providers who assist in our operations (under strict confidentiality agreements)</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold mb-4">Your Rights and Controls</h2>
              <div className="space-y-4 text-muted-foreground">
                <p>You have the following rights regarding your personal information:</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li><strong>Access:</strong> Request access to your personal data</li>
                  <li><strong>Correction:</strong> Request correction of inaccurate data</li>
                  <li><strong>Deletion:</strong> Request deletion of your personal data</li>
                  <li><strong>Portability:</strong> Request a copy of your data in a portable format</li>
                  <li><strong>Opt-out:</strong> Opt out of non-essential data collection</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold mb-4">Security Measures</h2>
              <div className="space-y-4 text-muted-foreground">
                <p>We implement industry-standard security measures to protect your information:</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>End-to-end encryption for all data transmission</li>
                  <li>Secure storage with advanced encryption protocols</li>
                  <li>Regular security audits and penetration testing</li>
                  <li>Multi-factor authentication for sensitive operations</li>
                  <li>Zero-knowledge architecture where possible</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="glassmorphism">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
              <div className="space-y-4 text-muted-foreground">
                <p>If you have any questions about this Privacy Policy or our data practices, please contact us:</p>
                <ul className="space-y-2">
                  <li><strong>Email:</strong> privacy@engipay.com</li>
                  <li><strong>Address:</strong> [Company Address]</li>
                  <li><strong>Data Protection Officer:</strong> dpo@engipay.com</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="glassmorphism">
            <CardContent className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                This Privacy Policy was last updated on January 24, 2026. We may update this policy from time to time, 
                and we will notify you of any material changes.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}