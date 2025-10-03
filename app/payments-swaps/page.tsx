"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/contexts/WalletContext"
import { ServicePurchase } from "@/components/payments/ServicePurchase"
import { BtcSwap } from "@/components/payments/BtcSwap"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Send,
  ArrowLeftRight,
  QrCode,
  Building2,
  Zap,
  Bitcoin,
  Coins,
  Clock,
  Filter,
  Calendar,
  DollarSign,
  ArrowLeft,
} from "lucide-react"
import { getBitcoinBalance, sendBitcoin } from "@/lib/xverse"
import { toast } from "@/hooks/use-toast"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import { TabType } from "@/types/dashboard"

export default function PaymentsSwapsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("payments")
  const [selectedToken, setSelectedToken] = useState("")
  const [amount, setAmount] = useState("")
  const [destinationToken, setDestinationToken] = useState("")
  const [btcBalance, setBtcBalance] = useState<any>(null)
  const [btcRecipient, setBtcRecipient] = useState("")
  const [btcSendAmount, setBtcSendAmount] = useState("")
  const [isSendingBtc, setIsSendingBtc] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const router = useRouter()
  const { isConnected, walletName } = useWallet()

  useEffect(() => {
    // Set client flag to prevent hydration issues
    setIsClient(true)

    // Only check localStorage on client side to prevent hydration mismatch
    if (typeof window !== 'undefined') {
      const savedWallet = localStorage.getItem("engipay-wallet")
      const hasWalletConnection = isConnected || savedWallet

      if (!hasWalletConnection) {
        router.push('/')
        return
      }
    }
  }, [isConnected, router])

  useEffect(() => {
    // Load BTC balance if Xverse is connected
    const loadBtcBalance = async () => {
      if (walletName === 'Xverse') {
        try {
          const balance = await getBitcoinBalance()
          setBtcBalance(balance)
        } catch (error) {
          console.error('Error loading BTC balance:', error)
        }
      }
    }
    loadBtcBalance()
  }, [walletName])

  // Prevent hydration mismatch by not rendering until client-side
  if (!isClient) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading...</p>
        </div>
      </div>
    )
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
      action: () => console.log("Send Payment"),
    },
    {
      icon: <ArrowLeftRight className="w-6 h-6" />,
      title: "Request Payment",
      description: "Ask for payment from contacts",
      action: () => console.log("Request Payment"),
    },
    {
      icon: <QrCode className="w-6 h-6" />,
      title: "Scan QR",
      description: "Scan QR code to pay",
      action: () => console.log("Scan QR"),
    },
    {
      icon: <Building2 className="w-6 h-6" />,
      title: "Merchant Payments",
      description: "Pay merchants wallet-to-wallet",
      action: () => console.log("Merchant Payments"),
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Chipi Pay",
      description: "Powered by Chipi Pay SDK",
      action: () => console.log("Chipi Pay"),
      isSdk: true,
    },
  ]

  const tokens = [
    { symbol: "BTC", name: "Bitcoin" },
    { symbol: "ETH", name: "Ethereum" },
    { symbol: "STRK", name: "Starknet" },
  ]

  const mockTransactions = [
    {
      id: 1,
      type: "Payment",
      amount: "-0.05 ETH",
      to: "0x1234...5678",
      date: "2024-01-15",
      status: "Completed",
      asset: "ETH",
    },
    {
      id: 2,
      type: "Swap",
      amount: "+0.1 STRK",
      from: "0.02 BTC",
      date: "2024-01-14",
      status: "Completed",
      asset: "STRK",
    },
    {
      id: 3,
      type: "Payment",
      amount: "+0.2 ETH",
      from: "merchant@example.com",
      date: "2024-01-13",
      status: "Pending",
      asset: "ETH",
    },
  ]

  const handleSwap = () => {
    console.log("Swap initiated", { selectedToken, amount, destinationToken })
  }

  const handleSendBtc = async () => {
    if (!btcRecipient || !btcSendAmount) {
      toast({
        title: "Missing Information",
        description: "Please enter recipient address and amount",
        variant: "destructive",
      })
      return
    }

    const amountSatoshis = Math.floor(parseFloat(btcSendAmount) * 100000000) // Convert BTC to satoshis

    setIsSendingBtc(true)
    try {
      const result = await sendBitcoin({
        to: btcRecipient,
        amount: amountSatoshis,
        feeRate: 1, // 1 sat/vB
      })

      if (result.success) {
        toast({
          title: "BTC Sent Successfully",
          description: `Transaction ID: ${result.txId}`,
        })
        setBtcRecipient("")
        setBtcSendAmount("")
        // Refresh balance
        const balance = await getBitcoinBalance()
        setBtcBalance(balance)
      } else {
        throw new Error(result.error)
      }
    } catch (error: any) {
      toast({
        title: "Send Failed",
        description: error.message || "Failed to send BTC",
        variant: "destructive",
      })
    } finally {
      setIsSendingBtc(false)
    }
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
        {walletName === 'Xverse' && (
          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
              <Bitcoin className="w-8 h-8 text-orange-500" />
              Bitcoin Operations
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="glassmorphism">
                <CardHeader>
                  <CardTitle>Balance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-400">
                    {btcBalance ? (btcBalance.total / 100000000).toFixed(8) : '0.00000000'} BTC
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Confirmed: {btcBalance ? (btcBalance.confirmed / 100000000).toFixed(8) : '0.00000000'} BTC
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Unconfirmed: {btcBalance ? (btcBalance.unconfirmed / 100000000).toFixed(8) : '0.00000000'} BTC
                  </p>
                </CardContent>
              </Card>

              <Card className="glassmorphism">
                <CardHeader>
                  <CardTitle>Send BTC</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Recipient Address</label>
                    <Input
                      placeholder="bc1q..."
                      value={btcRecipient}
                      onChange={(e) => setBtcRecipient(e.target.value)}
                      className="glassmorphism"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Amount (BTC)</label>
                    <Input
                      type="number"
                      placeholder="0.00000000"
                      value={btcSendAmount}
                      onChange={(e) => setBtcSendAmount(e.target.value)}
                      className="glassmorphism"
                      step="0.00000001"
                    />
                  </div>
                  <Button
                    onClick={handleSendBtc}
                    disabled={isSendingBtc || !btcRecipient || !btcSendAmount}
                    className="glow-button bg-orange-500 hover:bg-orange-500/90 text-white w-full"
                  >
                    {isSendingBtc ? 'Sending...' : 'Send BTC'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        {/* Chipi Pay Service Purchase */}
        <section className="mb-12">
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
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-3xl font-bold flex items-center gap-2">
              <Clock className="w-8 h-8 text-primary" />
              Transaction History
            </h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                <Filter className="w-4 h-4 mr-2" />
                Filter
              </Button>
              <Button variant="outline" size="sm">
                <Calendar className="w-4 h-4 mr-2" />
                Date
              </Button>
            </div>
          </div>
          <Card className="glassmorphism">
            <CardContent className="p-0">
              <ScrollArea className="h-96">
                <div className="divide-y divide-border">
                  {mockTransactions.map((tx) => (
                    <div key={tx.id} className="p-4 hover:bg-muted/10 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full ${tx.type === 'Payment' ? 'bg-[#22D3EE]/20' : 'bg-[#34D399]/20'}`}>
                            {tx.type === 'Payment' ? <Send className="w-4 h-4" /> : <ArrowLeftRight className="w-4 h-4" />}
                          </div>
                          <div>
                            <p className="font-medium">{tx.type}</p>
                            <p className="text-sm text-muted-foreground">
                              {tx.type === 'Payment' ? `To: ${tx.to}` : `From: ${tx.from}`}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${tx.amount.startsWith('-') ? 'text-red-500' : 'text-green-500'}`}>
                            {tx.amount}
                          </p>
                          <p className="text-sm text-muted-foreground">{tx.date}</p>
                        </div>
                        <Badge variant={tx.status === 'Completed' ? 'default' : 'secondary'}>
                          {tx.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}