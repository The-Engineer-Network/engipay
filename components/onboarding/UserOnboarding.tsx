"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { 
  Wallet, 
  Shield, 
  Coins, 
  TrendingUp, 
  ArrowRight, 
  CheckCircle,
  Play,
  BookOpen,
  Zap
} from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { toast } from "@/hooks/use-toast"

interface OnboardingStep {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  completed: boolean
  action?: () => void
  actionText?: string
}

export function UserOnboarding() {
  const [currentStep, setCurrentStep] = useState(0)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const { isConnected, connectWallet, showWalletModal, setShowWalletModal } = useWallet()

  useEffect(() => {
    // Check if user has completed onboarding
    const hasCompletedOnboarding = localStorage.getItem("engipay-onboarding-completed")
    if (!hasCompletedOnboarding && !isConnected) {
      setShowOnboarding(true)
    }
  }, [isConnected])

  const steps: OnboardingStep[] = [
    {
      id: "welcome",
      title: "Welcome to EngiPay",
      description: "Your gateway to Web3 payments and DeFi. Let's get you started with a quick tour.",
      icon: <Zap className="w-8 h-8" />,
      completed: true,
    },
    {
      id: "connect-wallet",
      title: "Connect Your Wallet",
      description: "Connect your Web3 wallet to start using EngiPay. We support MetaMask, Argent, Braavos, and Xverse.",
      icon: <Wallet className="w-8 h-8" />,
      completed: isConnected,
      action: () => setShowWalletModal(true),
      actionText: "Connect Wallet"
    },
    {
      id: "security",
      title: "Security First",
      description: "Your funds remain in your wallet at all times. We never have access to your private keys.",
      icon: <Shield className="w-8 h-8" />,
      completed: isConnected,
    },
    {
      id: "features",
      title: "Explore Features",
      description: "Send payments, swap tokens across chains, and earn with DeFi - all in one app.",
      icon: <Coins className="w-8 h-8" />,
      completed: false,
    },
    {
      id: "defi",
      title: "DeFi Opportunities",
      description: "Discover lending, staking, and yield farming opportunities to grow your crypto.",
      icon: <TrendingUp className="w-8 h-8" />,
      completed: false,
    },
  ]

  const progress = (steps.filter(step => step.completed).length / steps.length) * 100

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      completeOnboarding()
    }
  }

  const handleSkip = () => {
    completeOnboarding()
  }

  const completeOnboarding = () => {
    localStorage.setItem("engipay-onboarding-completed", "true")
    setShowOnboarding(false)
    toast({
      title: "Welcome to EngiPay!",
      description: "You're all set to start using Web3 payments and DeFi.",
    })
  }

  const handleStepAction = (step: OnboardingStep) => {
    if (step.action) {
      step.action()
    }
  }

  if (!showOnboarding) return null

  const currentStepData = steps[currentStep]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <Card className="w-full max-w-2xl mx-4 glassmorphism">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center text-primary">
              {currentStepData.icon}
            </div>
          </div>
          <CardTitle className="text-2xl mb-2">{currentStepData.title}</CardTitle>
          <p className="text-muted-foreground">{currentStepData.description}</p>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress</span>
              <span>{Math.round(progress)}% Complete</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Step Indicators */}
          <div className="flex justify-center space-x-2">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={`w-3 h-3 rounded-full transition-colors ${
                  index === currentStep
                    ? "bg-primary"
                    : step.completed
                    ? "bg-green-500"
                    : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* Step Content */}
          <div className="text-center space-y-4">
            {currentStepData.id === "welcome" && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                      <Wallet className="w-6 h-6 text-blue-400" />
                    </div>
                    <p className="text-sm">Payments</p>
                  </div>
                  <div className="text-center">
                    <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                      <Coins className="w-6 h-6 text-green-400" />
                    </div>
                    <p className="text-sm">Swaps</p>
                  </div>
                  <div className="text-center">
                    <div className="w-12 h-12 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                      <TrendingUp className="w-6 h-6 text-purple-400" />
                    </div>
                    <p className="text-sm">DeFi</p>
                  </div>
                </div>
              </div>
            )}

            {currentStepData.id === "connect-wallet" && !isConnected && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Choose from our supported wallets to get started
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 border border-border rounded-lg">
                    <p className="font-medium">MetaMask</p>
                    <p className="text-xs text-muted-foreground">Ethereum & EVM</p>
                  </div>
                  <div className="p-3 border border-border rounded-lg">
                    <p className="font-medium">Xverse</p>
                    <p className="text-xs text-muted-foreground">Bitcoin</p>
                  </div>
                  <div className="p-3 border border-border rounded-lg">
                    <p className="font-medium">Argent</p>
                    <p className="text-xs text-muted-foreground">StarkNet</p>
                  </div>
                  <div className="p-3 border border-border rounded-lg">
                    <p className="font-medium">Braavos</p>
                    <p className="text-xs text-muted-foreground">StarkNet</p>
                  </div>
                </div>
              </div>
            )}

            {currentStepData.id === "connect-wallet" && isConnected && (
              <div className="space-y-4">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                </div>
                <p className="text-green-400 font-medium">Wallet Connected Successfully!</p>
              </div>
            )}

            {currentStepData.id === "security" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 text-left">
                  <div className="flex items-start gap-3 p-3 bg-green-500/10 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Non-Custodial</p>
                      <p className="text-xs text-muted-foreground">You control your private keys</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-green-500/10 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Zero-Knowledge Security</p>
                      <p className="text-xs text-muted-foreground">Built on StarkNet's ZK technology</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-green-500/10 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Audited Smart Contracts</p>
                      <p className="text-xs text-muted-foreground">Professional security reviews</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentStepData.id === "features" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  <div className="p-4 border border-border rounded-lg text-left">
                    <div className="flex items-center gap-3 mb-2">
                      <Zap className="w-5 h-5 text-blue-400" />
                      <h4 className="font-medium">Instant Payments</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">Send money to friends or pay merchants instantly</p>
                  </div>
                  <div className="p-4 border border-border rounded-lg text-left">
                    <div className="flex items-center gap-3 mb-2">
                      <Coins className="w-5 h-5 text-green-400" />
                      <h4 className="font-medium">Cross-Chain Swaps</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">Swap BTC ↔ ETH ↔ STRK seamlessly</p>
                  </div>
                  <div className="p-4 border border-border rounded-lg text-left">
                    <div className="flex items-center gap-3 mb-2">
                      <TrendingUp className="w-5 h-5 text-purple-400" />
                      <h4 className="font-medium">DeFi Integration</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">Access lending, staking, and yield farming</p>
                  </div>
                </div>
              </div>
            )}

            {currentStepData.id === "defi" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  <div className="p-4 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-lg text-left">
                    <h4 className="font-medium mb-2">Vesu Lending</h4>
                    <p className="text-sm text-muted-foreground">Earn up to 8% APY by lending your assets</p>
                    <Badge className="mt-2 bg-blue-500/20 text-blue-400">Low Risk</Badge>
                  </div>
                  <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-lg text-left">
                    <h4 className="font-medium mb-2">Trove Staking</h4>
                    <p className="text-sm text-muted-foreground">Stake STRK tokens for up to 12% APY</p>
                    <Badge className="mt-2 bg-green-500/20 text-green-400">Medium Risk</Badge>
                  </div>
                  <div className="p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg text-left">
                    <h4 className="font-medium mb-2">Endurfi Farming</h4>
                    <p className="text-sm text-muted-foreground">Provide liquidity for up to 25% APY</p>
                    <Badge className="mt-2 bg-purple-500/20 text-purple-400">High Risk</Badge>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={handleSkip}>
              Skip Tour
            </Button>
            <div className="flex gap-2">
              {currentStepData.action && !currentStepData.completed && (
                <Button onClick={() => handleStepAction(currentStepData)}>
                  {currentStepData.actionText}
                </Button>
              )}
              <Button onClick={handleNext}>
                {currentStep === steps.length - 1 ? "Get Started" : "Next"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}