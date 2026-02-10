"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useWallet } from "@/contexts/WalletContext"

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'

export function LendingBorrowing() {
  const [selectedAsset, setSelectedAsset] = useState("ETH")
  const [amount, setAmount] = useState("")
  const [activeTab, setActiveTab] = useState("supply")
  const [lendingPools, setLendingPools] = useState<any[]>([])
  const [userPositions, setUserPositions] = useState<any[]>([])
  const [userBalance, setUserBalance] = useState("0")
  const [healthFactor, setHealthFactor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  
  const { toast } = useToast()
  const { walletAddress } = useWallet()

  // Load data on mount and when wallet changes
  useEffect(() => {
    if (walletAddress) {
      loadLendingData()
      loadUserPositions()
    }
  }, [walletAddress])

  // Load lending pools data
  const loadLendingData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/vesu/pools`)
      const data = await response.json()
      
      if (data.success) {
        setLendingPools(data.pools || [])
      }
    } catch (error) {
      console.error('Error loading lending data:', error)
      toast({
        title: "Error",
        description: "Failed to load lending pools",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  // Load user positions
  const loadUserPositions = async () => {
    if (!walletAddress) return
    
    try {
      const response = await fetch(`${API_URL}/vesu/positions/${walletAddress}`)
      const data = await response.json()
      
      if (data.success) {
        setUserPositions(data.positions || [])
        setHealthFactor(data.healthFactor)
      }
    } catch (error) {
      console.error('Error loading user positions:', error)
    }
  }

  // Get user balance for selected asset
  const getUserBalance = async (asset: string) => {
    if (!walletAddress) return
    
    try {
      const response = await fetch(`${API_URL}/vesu/balance/${walletAddress}/${asset}`)
      const data = await response.json()
      
      if (data.success) {
        setUserBalance(data.balance)
      }
    } catch (error) {
      console.error('Error loading balance:', error)
    }
  }

  // Handle supply
  const handleSupply = async () => {
    if (!walletAddress || !amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid Input",
        description: "Please enter a valid amount",
        variant: "destructive"
      })
      return
    }

    setIsProcessing(true)
    try {
      const response = await fetch(`${API_URL}/vesu/supply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: walletAddress,
          asset: selectedAsset,
          amount: amount
        })
      })

      const data = await response.json()

      if (data.success) {
        toast({
          title: "Success",
          description: `Successfully supplied ${amount} ${selectedAsset}`
        })
        setAmount("")
        loadLendingData()
        loadUserPositions()
      } else {
        throw new Error(data.error || 'Supply failed')
      }
    } catch (error: any) {
      toast({
        title: "Supply Failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setIsProcessing(false)
    }
  }

  // Handle borrow
  const handleBorrow = async () => {
    if (!walletAddress || !amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid Input",
        description: "Please enter a valid amount",
        variant: "destructive"
      })
      return
    }

    setIsProcessing(true)
    try {
      const response = await fetch(`${API_URL}/vesu/borrow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: walletAddress,
          asset: selectedAsset,
          amount: amount
        })
      })

      const data = await response.json()

      if (data.success) {
        toast({
          title: "Success",
          description: `Successfully borrowed ${amount} ${selectedAsset}`
        })
        setAmount("")
        loadLendingData()
        loadUserPositions()
      } else {
        throw new Error(data.error || 'Borrow failed')
      }
    } catch (error: any) {
      toast({
        title: "Borrow Failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setIsProcessing(false)
    }
  }

  // Handle withdraw
  const handleWithdraw = async (positionAsset: string, positionAmount: string) => {
    if (!walletAddress) return

    setIsProcessing(true)
    try {
      const response = await fetch(`${API_URL}/vesu/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: walletAddress,
          asset: positi
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-balance">Lending & Borrowing</h2>
          <p className="text-muted-foreground">Powered by Vesu Protocol</p>
        </div>
        <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
          Vesu SDK
        </Badge>
      </div>

      {/* Action Panel */}
      <Card className="gradient-card glow-effect">
        <CardHeader>
          <CardTitle>Lend or Borrow Assets</CardTitle>
          <CardDescription>Supply assets to earn yield or borrow against your collateral</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 bg-secondary/50">
              <TabsTrigger
                value="supply"
                className="cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
              >
                Supply
              </TabsTrigger>
              <TabsTrigger
                value="borrow"
                className="cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
              >
                Borrow
              </TabsTrigger>
            </TabsList>

            <TabsContent value="supply" className="space-y-4 mt-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="supply-asset">Asset</Label>
                  <Select value={selectedAsset} onValueChange={setSelectedAsset}>
                    <SelectTrigger className="cursor-pointer hover:bg-secondary/50 transition-colors">
                      <SelectValue placeholder="Select asset" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ETH" className="cursor-pointer">
                        ETH
                      </SelectItem>
                      <SelectItem value="STRK" className="cursor-pointer">
                        STRK
                      </SelectItem>
                      <SelectItem value="USDC" className="cursor-pointer">
                        USDC
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supply-amount">Amount</Label>
                  <Input
                    id="supply-amount"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="hover:border-primary/50 transition-colors"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Supply APY</span>
                <span className="text-primary font-medium">4.2%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Available Balance</span>
                <span>1.2 ETH</span>
              </div>
              <Button className="w-full cursor-pointer hover:bg-primary/90 transition-colors" size="lg">
                Supply {selectedAsset}
              </Button>
            </TabsContent>

            <TabsContent value="borrow" className="space-y-4 mt-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="borrow-asset">Asset</Label>
                  <Select value={selectedAsset} onValueChange={setSelectedAsset}>
                    <SelectTrigger className="cursor-pointer hover:bg-secondary/50 transition-colors">
                      <SelectValue placeholder="Select asset" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ETH" className="cursor-pointer">
                        ETH
                      </SelectItem>
                      <SelectItem value="STRK" className="cursor-pointer">
                        STRK
                      </SelectItem>
                      <SelectItem value="USDC" className="cursor-pointer">
                        USDC
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="borrow-amount">Amount</Label>
                  <Input
                    id="borrow-amount"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="hover:border-primary/50 transition-colors"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Borrow APY</span>
                <span className="text-destructive font-medium">6.8%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Available to Borrow</span>
                <span>0.4 ETH</span>
              </div>
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">Health Factor: 2.1 → 1.8</span>
                </div>
              </div>
              <Button className="w-full cursor-pointer hover:bg-primary/90 transition-colors" size="lg">
                Borrow {selectedAsset}
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Market Overview */}
      <Card className="gradient-card hover:glow-effect transition-all">
        <CardHeader>
          <CardTitle>Market Overview</CardTitle>
          <CardDescription>Current lending and borrowing rates across assets</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {lendingPools.map((pool) => (
              <div
                key={pool.asset}
                className="p-4 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <span className="text-sm font-bold text-primary">{pool.asset}</span>
                    </div>
                    <span className="font-medium">{pool.asset}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground">Utilization</div>
                    <div className="font-medium">{pool.utilization}%</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Supply APY</div>
                    <div className="font-medium text-primary">{pool.supplyAPY}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Borrow APY</div>
                    <div className="font-medium text-destructive">{pool.borrowAPY}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total Supplied</div>
                    <div className="font-medium">{pool.totalSupplied}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Available</div>
                    <div className="font-medium">{pool.available}</div>
                  </div>
                </div>

                <Progress value={pool.utilization} className="mt-3" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Position of the User*/}
      <Card className="gradient-card hover:glow-effect transition-all">
        <CardHeader>
          <CardTitle>Your Positions</CardTitle>
          <CardDescription>Your active lending and borrowing positions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {userPositions.map((position, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <Badge variant={position.type === "Supply" ? "secondary" : "destructive"}>{position.type}</Badge>
                  <div>
                    <div className="font-medium">{position.asset}</div>
                    <div className="text-sm text-muted-foreground">{position.amount}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{position.value}</div>
                  <div className="text-sm text-muted-foreground">
                    {position.type === "Supply" ? `+${position.earned}` : `-${position.cost}`} • {position.apy}
                  </div>
                </div>
                {position.healthFactor && (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    <span className="text-sm">HF: {position.healthFactor}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
