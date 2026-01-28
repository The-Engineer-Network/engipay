"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Zap,
  ArrowRightLeft,
  Bitcoin,
  TrendingUp,
  Check,
  Menu,
  X,
  Wallet,
  BarChart3,
  CreditCard,
  User,
  Settings,
} from "lucide-react"
import Link from "next/link"
import { WalletConnectModal } from "@/components/WalletConnectModal"
import { LovelyLoader } from "@/components/ui/loader"
import { useWallet } from "@/contexts/WalletContext"

export default function EngiPayLanding() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [typedText, setTypedText] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSubscribing, setIsSubscribing] = useState(false)
  const router = useRouter()
  const { walletAddress, walletName, disconnectWallet, isConnected } = useWallet()
  const fullText =
    "Send, Swap, and Earn in one wallet-native experience — no banks, no intermediaries, just your wallet."

  useEffect(() => {
    let i = 0
    let isDeleting = false

    const animateText = () => {
      if (!isDeleting && i < fullText.length) {
        setTypedText(fullText.slice(0, i + 1))
        i++
        setTimeout(animateText, 50)
      } else if (!isDeleting && i === fullText.length) {
        setTimeout(() => {
          isDeleting = true
          animateText()
        }, 2000)
      } else if (isDeleting && i > 0) {
        setTypedText(fullText.slice(0, i - 1))
        i--
        setTimeout(animateText, 30)
      } else if (isDeleting && i === 0) {
        isDeleting = false
        setTimeout(animateText, 500)
      }
    }

    animateText()
  }, [])

  useEffect(() => {
    // Simulate initial loading
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 500)

    return () => clearTimeout(timer)
  }, [])

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId)
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
    }
    setMobileMenuOpen(false)
  }

  const handleGetStarted = () => {
    setIsLoading(true)
    // Simulate loading delay for wallet connection
    setTimeout(() => {
      setIsLoading(false)
      setShowWalletModal(true)
    }, 200)
  }

  const handleSubscribe = () => {
    setIsSubscribing(true)
    // Simulate subscription process
    setTimeout(() => {
      setIsSubscribing(false)
      // You could add a success message here
    }, 200)
  }

  const handleWalletDisconnect = () => {
    disconnectWallet()
  }

  const XLogo = () => (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>
    </svg>
  )

  const features = [
    {
      icon: <Zap className="w-8 h-8" />,
      title: "Instant Payments",
      description: "P2P & Merchant payments powered by Chipi-Pay SDK",
    },
    {
      icon: <ArrowRightLeft className="w-8 h-8" />,
      title: "Cross-Chain Swaps",
      description: "Seamlessly swap BTC ↔ STRK/ETH via Atomiq SDK",
    },
    {
      icon: <Bitcoin className="w-8 h-8" />,
      title: "Bitcoin Ready",
      description: "Accept and send Bitcoin directly via Xverse Wallet API",
    },
    {
      icon: <TrendingUp className="w-8 h-8" />,
      title: "DeFi Power Tools",
      description: "Lending, Borrowing, Yield Farming, Staking",
    },
  ]

  const benefits = [
    "Pay friends & merchants instantly",
    "Swap tokens across chains (BTC ↔ ETH/STRK)",
    "Access lending, borrowing, and yield farming",
    "Simple, secure, and built for the on-chain economy",
  ]

  const exploreCards = [
    { title: "Wallet & Onboarding", icon: <Wallet className="w-6 h-6" /> },
    { title: "Dashboard", icon: <BarChart3 className="w-6 h-6" /> },
    { title: "Payments & Swaps", icon: <CreditCard className="w-6 h-6" /> },
    { title: "DeFi & Profile", icon: <User className="w-6 h-6" /> },
  ]

  const partners = ["StarkNet", "Infura", "Argent", "MetaMask", "Coinbase", "Uniswap"]

  return (
    <div className="min-h-screen cosmic-bg text-foreground">
      <WalletConnectModal open={showWalletModal} onOpenChange={setShowWalletModal} />

      {/* Lovely Loader Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-500">
          <div className="text-center animate-in slide-in-from-bottom-4 duration-700 delay-200">
            <LovelyLoader size="lg" className="mb-4" />
            <p className="text-white text-lg font-medium animate-in slide-in-from-bottom-2 duration-500 delay-300">Loading EngiPay...</p>
          </div>
        </div>
      )}

      {/* Floating Orbs */}
      <div
        className="glow-orb w-32 h-32 bg-gradient-to-r from-primary/30 to-secondary/30 top-20 left-10"
        style={{ animationDelay: "0s" }}
      />
      <div
        className="glow-orb w-24 h-24 bg-gradient-to-r from-secondary/20 to-accent/20 top-40 right-20"
        style={{ animationDelay: "2s" }}
      />
      <div
        className="glow-orb w-40 h-40 bg-gradient-to-r from-accent/20 to-primary/20 bottom-40 left-1/4"
        style={{ animationDelay: "4s" }}
      />

      {/* Navigation */}
      <nav className="sticky top-0 z-50 glassmorphism backdrop-blur-md bg-black/20 border-b border-white/10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 overflow-hidden">
                <img
                className=" w-10 h-10 object-contain filter brightness-0"
                src="/engipay.png" alt="EngiPay Logo"
                />
              <span className="-pl-2 text-xl font-bold text-black">EngiPay</span>
            </div>

            {/* Desktop Menu */}
            <div className="hidden md:flex items-center space-x-8">
              {isConnected && (
                <Link href="/dashboard" className="text-black hover:text-purple-500 transition-colors font-medium">
                  Dashboard
                </Link>
              )}
              <Link href="/features" className="text-black hover:text-purple-500 transition-colors font-medium">
                Features
              </Link>
              <Link href="/technology" className="text-black hover:text-purple-500 transition-colors font-medium">
                Technology
              </Link>
              <Link href="/about" className="text-black hover:text-purple-500 transition-colors font-medium">
                About
              </Link>
              <Link href="/faq" className="text-black hover:text-purple-500 transition-colors font-medium">
                FAQ
              </Link>
              <Link href="/help" className="text-black hover:text-purple-500 transition-colors font-medium">
                Help
              </Link>
              <div className="flex items-center space-x-2">
                {isConnected ? (
                  <Button
                    className="glow-button bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
                    onClick={handleWalletDisconnect}
                  >
                    <Wallet className="w-4 h-4" />
                    {walletName} ({walletAddress?.slice(0, 6)}...)
                  </Button>
                ) : (
                  <Button
                    className="glow-button bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2"
                    onClick={handleGetStarted}
                  >
                    <Settings className="w-4 h-4" />
                    Connect Wallet
                  </Button>
                )}
              </div>
            </div>

            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-black"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X /> : <Menu />}
            </Button>
          </div>

          {/* Mobile Menu */}
          <div
            className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${
              mobileMenuOpen
                ? 'max-h-96 opacity-100 mt-4 pb-4'
                : 'max-h-0 opacity-0'
            }`}
          >
            <div className="space-y-4">
              {isConnected && (
                <Link
                  href="/dashboard"
                  className="block text-black hover:text-purple-500 transition-colors font-medium w-full text-left"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Dashboard
                </Link>
              )}
              <Link
                href="/features"
                className="block text-black hover:text-purple-500 transition-colors font-medium w-full text-left"
                onClick={() => setMobileMenuOpen(false)}
              >
                Features
              </Link>
              <Link
                href="/technology"
                className="block text-black hover:text-purple-500 transition-colors font-medium w-full text-left"
                onClick={() => setMobileMenuOpen(false)}
              >
                Technology
              </Link>
              <Link
                href="/about"
                className="block text-black hover:text-purple-500 transition-colors font-medium w-full text-left"
                onClick={() => setMobileMenuOpen(false)}
              >
                About
              </Link>
              <Link
                href="/faq"
                className="block text-black hover:text-purple-500 transition-colors font-medium w-full text-left"
                onClick={() => setMobileMenuOpen(false)}
              >
                FAQ
              </Link>
              <Link
                href="/help"
                className="block text-black hover:text-purple-500 transition-colors font-medium w-full text-left"
                onClick={() => setMobileMenuOpen(false)}
              >
                Help
              </Link>
              <div className="flex space-x-2">
                {isConnected ? (
                  <Button
                    className="flex-1 glow-button bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
                    onClick={() => {
                      handleWalletDisconnect()
                      setMobileMenuOpen(false)
                    }}
                  >
                    <Wallet className="w-4 h-4" />
                    {walletName} ({walletAddress?.slice(0, 6)}...)
                  </Button>
                ) : (
                  <Button
                    className="flex-1 glow-button bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2"
                    onClick={() => {
                      handleGetStarted()
                      setMobileMenuOpen(false)
                    }}
                  >
                    <Settings className="w-4 h-4" />
                    Connect Wallet
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 relative">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left side - Hero content */}
          <div className="text-left">
            <Badge className="mb-6 bg-purple-500/20 text-black border-purple-500/30 font-semibold">
              Next-Gen Web3 Payments
            </Badge>
            <h1 className="text-5xl md:text-7xl font-bold mb-6 text-balance text-black">
              The Next-Gen
              <span className="block text-purple-600" style={{textShadow: '0 0 10px rgba(0, 0, 0, 0.8), 0 0 20px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 0, 0, 0.4)'}}>
                Payments + DeFi
              </span>
              <span className="block text-black">Super App</span>
            </h1>
            <p className="text-xl md:text-2xl mb-8 text-black min-h-[3rem] text-pretty font-medium">
              {typedText}
              <span className="animate-pulse text-purple-500">|</span>
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                size="lg"
                className="glow-button bg-purple-600 hover:bg-purple-700 text-white text-lg px-8 py-6 transform skew-x-12"
                onClick={handleGetStarted}
              >
                Get Started
              </Button>
              <Button
                size="lg"
                className="md:w-14 md:h-14 w-auto h-14 px-6 bg-black hover:bg-gray-800 text-white border-2 border-purple-500/30 hover:border-purple-500 transform skew-x-12"
                onClick={() => window.open("https://twitter.com/engipay", "_blank")}
              >
                <span className="md:hidden">Follow on X</span>
                <span className="md:block hidden">
                  <XLogo />
                </span>
              </Button>
            </div>
          </div>

          {/* Right side - Glowing spheres with orbit rings */}
          <div className="relative h-96 lg:h-[500px] hidden lg:block">
            {/* Large central planet */}
            <div
              className="planet-sphere w-32 h-32 bg-gradient-to-br from-green-400 via-purple-500 to-blue-600 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
              style={{ animationDelay: "0s" }}
            />

            {/* Orbit ring for central planet */}
            <div
              className="orbit-ring w-48 h-48 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
              style={{ animationDelay: "0s" }}
            />

            {/* Medium planet - top right */}
            <div
              className="planet-sphere w-20 h-20 bg-gradient-to-br from-purple-400 to-pink-500 top-16 right-20"
              style={{ animationDelay: "2s" }}
            />

            {/* Orbit ring for medium planet */}
            <div className="orbit-ring w-32 h-32 top-8 right-12" style={{ animationDelay: "5s" }} />

            {/* Small planet - bottom left */}
            <div
              className="planet-sphere w-16 h-16 bg-gradient-to-br from-green-300 to-teal-400 bottom-20 left-16"
              style={{ animationDelay: "4s" }}
            />

            {/* Orbit ring for small planet */}
            <div className="orbit-ring w-24 h-24 bottom-16 left-12" style={{ animationDelay: "8s" }} />

            {/* Tiny accent planet */}
            <div
              className="planet-sphere w-12 h-12 bg-gradient-to-br from-yellow-300 to-orange-400 top-32 right-8"
              style={{ animationDelay: "6s" }}
            />
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section id="features" className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">Key Features</h2>
          <p className="text-xl text-muted-foreground">Powerful tools for the future of finance</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature, index) => (
            <Card key={index} className="glassmorphism hover:scale-105 transition-all duration-300 group">
              <CardContent className="p-6 text-center">
                <div className="text-primary mb-4 flex justify-center group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Why It Matters */}
      <section id="why" className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Why It Matters</h2>
            <p className="text-xl text-muted-foreground">
              EngiPay bridges everyday payments with powerful DeFi tools — all in one app.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {benefits.map((benefit, index) => (
              <div key={index} className="flex items-start space-x-4 group">
                <div className="flex-shrink-0 w-6 h-6 bg-primary rounded-full flex items-center justify-center mt-1 group-hover:scale-110 transition-transform">
                  <Check className="w-4 h-4 text-primary-foreground" />
                </div>
                <p className="text-lg">{benefit}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mid-Page CTA */}
      <section className="py-20 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-secondary/20 to-accent/20" />
        <div className="container mx-auto px-4 text-center relative">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Join thousands of users building the future of payments with EngiPay
          </h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
            <Button
              size="lg"
              className="glow-button bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => router.push("/about")}
            >
              Get to Know Us
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-purple-500/30 hover:bg-purple-500/10 bg-transparent"
              onClick={handleGetStarted}
            >
              Connect Wallet
            </Button>
          </div>
        </div>
      </section>

      {/* Explore EngiPay */}
      <section id="explore" className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">Explore EngiPay</h2>
          <p className="text-xl text-muted-foreground">Discover all the powerful features</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {exploreCards.map((card, index) => (
            <Card key={index} className="glassmorphism hover:scale-105 transition-all duration-300 cursor-pointer group">
              <CardContent className="p-8 text-center">
                <div className="text-primary mb-4 flex justify-center group-hover:scale-110 transition-transform">
                  {card.icon}
                </div>
                <h3 className="text-lg font-semibold">{card.title}</h3>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Trusted By */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-semibold mb-8 text-muted-foreground">Trusted by leading Web3 platforms</h2>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12">
            {partners.map((partner, index) => (
              <div
                key={index}
                className="text-lg font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              >
                {partner}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="footer" className="border-t border-border/50">
        <div className="container mx-auto px-4 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="md:col-span-2">
              <div className="flex items-center space-x-2 mb-4 overflow-hidden">
                  <img
                  className=" w-10 h-10 object-contain filter brightness-0 invert"
                  src="/engipay.png" alt="EngiPay Logo"
                  />
                <span className="-pl-2 text-xl font-bold text-white">EngiPay</span>
              </div>
              <p className="text-muted-foreground mb-6">Powering Lifestyle Finance on StarkNet.</p>
              <div className="flex space-x-2">
                <Input placeholder="Enter your email" className="glassmorphism border-border/50 focus:border-primary" />
                <Button
                  className="glow-button bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={handleSubscribe}
                  disabled={isSubscribing}
                >
                  {isSubscribing ? (
                    <div className="flex items-center gap-2">
                      <LovelyLoader size="sm" />
                      Subscribing...
                    </div>
                  ) : (
                    "Subscribe"
                  )}
                </Button>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <div className="space-y-2 text-sm text-muted-foreground">
                <a href="#" className="block hover:text-primary transition-colors">
                  Features
                </a>
                <a href="#" className="block hover:text-primary transition-colors">
                  Pricing
                </a>
                <a href="#" className="block hover:text-primary transition-colors">
                  Security
                </a>
                <a href="#" className="block hover:text-primary transition-colors">
                  Roadmap
                </a>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <div className="space-y-2 text-sm text-muted-foreground">
                <a href="#" className="block hover:text-primary transition-colors">
                  About
                </a>
                <a href="#" className="block hover:text-primary transition-colors">
                  Blog
                </a>
                <a href="#" className="block hover:text-primary transition-colors">
                  Careers
                </a>
                <a href="#" className="block hover:text-primary transition-colors">
                  Contact
                </a>
              </div>
            </div>
          </div>
          <div className="border-t border-border/50 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-sm text-muted-foreground">© 2025 EngiPay. All rights reserved.</p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <span className="sr-only">Twitter</span>𝕏
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <span className="sr-only">LinkedIn</span>
                in
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <span className="sr-only">GitHub</span>
                GitHub
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <span className="sr-only">Discord</span>
                Discord
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}



