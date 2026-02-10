"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Coins, TrendingUp, Clock, Zap, Loader2, Award } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useWallet } from "@/contexts/WalletContext"

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'

interface StakingPool {
  id: string
  name: string
  asset: string
  apy: string
  totalStaked: string
  lockPeriod: string
  minStake: string
  rewards: string[]
}

interface UserStake {
  poolId: string
  poolName: string
  asset: string
  amount: string
  value: string
  rewards: string
  apy: string
  stakedAt: string
  unlockAt: string
}

export function TroveStakingIntegrated() {
  const [pools, setPools] = useState<StakingPool[]>([])
  const [userStakes, setUserStakes] = useState<UserStake[]>([])
  const [selectedPool, setSelectedPool] = useState<string>("")
  const [stakeAmount, setStakeAmount] = useState("")
  const [unstakeAmount, setUnstakeAmount] = useState("")
  const [totalStaked, setTotalStaked] = useState("0")
  const [totalRewards, setTotalRewards] = useState("0")
  const [loading, setLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  
  const { toast } = useToast()
  const { walletAddress } = useWallet()

  useEffect(() => {
    loadPools()
    if (walletAddress) {
      loadUserStakes()
    }
  }, [walletAddress])

  const loadPools = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/staking/pools`)
      const data = await response.json()
      
      if (data.success && data.pools) {
        setPools(data.pools)
        if (data.pools.length > 0 && !selectedPool) {
          setSelectedPool(data.pools[0].id)
        }
      }
    } catch (error) {
      console.error('Error loading pools:', error)
      toast({
        title: "Error",
        description: "Failed to load staking pools",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  const loadUserStakes = async () => {
    if (!walletAddress) return
    
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_URL}/staking/positions`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      const data = await response.json()
      
      if (data.success) {
        setUserStakes(data.positions || [])
        
        // Calculate totals
        const total = data.positions?.reduce((sum: number, stake: any) => 
          sum + parseFloat(stake.value || '0'), 0) || 0
        const rewards = data.positions?.reduce((sum: number, stake: any) => 
          sum + parseFloat(stake.rewards || '0'), 0) || 0
          
        setTotalStaked(total.toString())
        setTotalRewards(rewards.toString())
      }
    } catch (error) {
      console.error('Error loading user stakes:', error)
    }
  }

  const handleStake = async () => {
    if (!walletAddress || !stakeAmount || !selectedPool || parseFloat(stakeAmount) <= 0) {
      toast({
        title: "Invalid Input",
        description: "Please select a pool and enter a valid amount",
        variant: "destructive"
      })
      return
    }

    setIsProcessing(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_URL}/staking/stake`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userAddress: walletAddress,
          poolId: selectedPool,
          amount: stakeAmount
        })
      })

      const data = await response.json()

      if (data.success) {
        toast({
          title: "Success",
          description: `Successfully staked ${stakeAmount} tokens`
        })
        setStakeAmount("")
        loadPools()
        loadUserStakes()
      } else {
        throw new Error(data.error || 'Staking failed')
      }
    } catch (error: any) {
      toast({
        title: "Staking Failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleUnstake = async (poolId: string, amount: string) => {
    if (!walletAddress) return

    setIsProcessing(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_URL}/staking/unstake`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userAddress: walletAddress,
          poolId: poolId,
          amount: amount
        })
      })

      const data = await response.json()

      if (data.success) {
        toast({
          title: "Success",
          description: `Successfully unstaked ${amount} tokens`
        })
        loadPools()
        loadUserStakes()
      } else {
        throw new Error(data.error || 'Unstaking failed')
      }
    } catch (error: any) {
      toast({
        title: "Unstaking Failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClaimRewards = async (poolId: string) => {
    if (!walletAddress) return

    setIsProcessing(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_URL}/staking/claim`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userAddress: walletAddress,
          poolId: poolId
        })
      })

      const data = await response.json()

      if (data.success) {
        toast({
          title: "Success",
          description: `Successfully claimed ${data.amount || 'rewards'}`
        })
        loadUserStakes()
      } else {
        throw new Error(data.error || 'Claim failed')
      }
    } catch (error: any) {
      toast({
        title: "Claim Failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const selectedPoolData = pools.find(p => p.id === selectedPool)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Trove Staking</h2>
          <p className="text-muted-foreground">Stake STRK and other assets to earn rewards</p>
        </div>
        <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
          Trove Protocol
        </Badge>
      </div>

      {/* Overview Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="gradient-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Staked</p>
                <p className="text-2xl font-bold">{parseFloat(totalStaked).toFixed(2)} STRK</p>
              </div>
              <Coins className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card className="gradient-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Rewards</p>
                <p className="text-2xl font-bold text-green-500">{parseFloat(totalRewards).toFixed(4)} STRK</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="gradient-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Stakes</p>
                <p className="text-2xl font-bold">{userStakes.length}</p>
              </div>
              <Award className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Staking Panel */}
      <Card className="gradient-card glow-effect">
        <CardHeader>
          <CardTitle>Stake Assets</CardTitle>
          <CardDescription>Choose a pool and stake your assets to earn rewards</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Staking Pool</Label>
              <select
                className="w-full p-2 rounded-md border bg-background"
                value={selectedPool}
                onChange={(e) => setSelectedPool(e.target.value)}
              >
                {pools.map(pool => (
                  <option key={pool.id} value={pool.id}>
                    {pool.name} - {pool.apy} APY
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
              />
            </div>
          </div>

          {selectedPoolData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm p-4 rounded-lg bg-secondary/50">
              <div>
                <div className="text-muted-foreground">APY</div>
                <div className="font-medium text-green-500">{selectedPoolData.apy}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Lock Period</div>
                <div className="font-medium">{selectedPoolData.lockPeriod}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Min Stake</div>
                <div className="font-medium">{selectedPoolData.minStake}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total Staked</div>
                <div className="font-medium">{selectedPoolData.totalStaked}</div>
              </div>
            </div>
          )}

          <Button 
            className="w-full" 
            size="lg"
            onClick={handleStake}
            disabled={isProcessing || !stakeAmount || !walletAddress}
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Stake {selectedPoolData?.asset || 'Tokens'}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Available Pools */}
      <Card>
        <CardHeader>
          <CardTitle>Available Staking Pools</CardTitle>
          <CardDescription>Choose from various staking options</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              {pools.map((pool) => (
                <div
                  key={pool.id}
                  className="p-4 rounded-lg bg-secondary/50 border hover:bg-secondary/70 transition-colors cursor-pointer"
                  onClick={() => setSelectedPool(pool.id)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <Coins className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">{pool.name}</div>
                        <div className="text-sm text-muted-foreground">{pool.asset}</div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-green-500/10 text-green-500">
                      {pool.apy} APY
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Lock Period</div>
                      <div className="font-medium">{pool.lockPeriod}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Min Stake</div>
                      <div className="font-medium">{pool.minStake}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total Staked</div>
                      <div className="font-medium">{pool.totalStaked}</div>
                    </div>
                  </div>

                  <div className="flex gap-1 mt-3">
                    {pool.rewards.map((reward) => (
                      <Badge key={reward} variant="outline" className="text-xs">
                        {reward}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Stakes */}
      {userStakes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your Active Stakes</CardTitle>
            <CardDescription>Manage your staking positions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {userStakes.map((stake, index) => (
                <div
                  key={index}
                  className="p-4 rounded-lg bg-secondary/50 border"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <span className="font-bold text-primary">{stake.asset}</span>
                      </div>
                      <div>
                        <div className="font-medium">{stake.poolName}</div>
                        <div className="text-sm text-muted-foreground">
                          {stake.amount} {stake.asset}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{stake.value}</div>
                      <div className="text-sm text-green-500">+{stake.rewards} rewards</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm mb-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>Unlocks: {new Date(stake.unlockAt).toLocaleDateString()}</span>
                    </div>
                    <Badge variant="secondary">{stake.apy} APY</Badge>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleClaimRewards(stake.poolId)}
                      disabled={isProcessing || parseFloat(stake.rewards) === 0}
                    >
                      Claim Rewards
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleUnstake(stake.poolId, stake.amount)}
                      disabled={isProcessing}
                    >
                      Unstake
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}