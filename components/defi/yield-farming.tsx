"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TrendingUp, Zap, Clock } from "lucide-react"

const farmingPools = [
  {
    protocol: "Trove",
    pair: "ETH/STRK",
    apy: "24.5%",
    tvl: "$240K",
    rewards: ["STRK", "TRV"],
    multiplier: "2x",
    lockPeriod: "30 days",
    risk: "Medium",
  },
  {
    protocol: "Endurfi",
    pair: "USDC/ETH",
    apy: "18.7%",
    tvl: "$510K",
    rewards: ["ENDR", "ETH"],
    multiplier: "1.5x",
    lockPeriod: "14 days",
    risk: "Low",
  },
  {
    protocol: "Trove",
    pair: "STRK/USDC",
    apy: "32.1%",
    tvl: "$180K",
    rewards: ["STRK", "TRV"],
    multiplier: "3x",
    lockPeriod: "60 days",
    risk: "High",
  },
]

const stakingPools = [
  {
    protocol: "Endurfi",
    asset: "ENDR",
    apy: "15.2%",
    tvl: "$870K",
    rewards: ["ENDR"],
    lockPeriod: "Flexible",
    risk: "Low",
  },
  {
    protocol: "Trove",
    asset: "TRV",
    apy: "22.8%",
    tvl: "$320K",
    rewards: ["TRV", "STRK"],
    lockPeriod: "90 days",
    risk: "Medium",
  },
]

const userFarms = [
  {
    protocol: "Trove",
    pair: "ETH/STRK",
    staked: "0.5 LP",
    value: "$1,050",
    rewards: "$25.75",
    apy: "24.5%",
    timeLeft: "23 days",
  },
  {
    protocol: "Endurfi",
    asset: "ENDR",
    staked: "2,000 ENDR",
    value: "$640",
    rewards: "$9.73",
    apy: "15.2%",
    timeLeft: "Flexible",
  },
]

export function YieldFarming() {
  const [selectedPool, setSelectedPool] = useState("")
  const [amount, setAmount] = useState("")
  const [activeTab, setActiveTab] = useState("farming")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-balance">Yield Farming & Staking</h2>
          <p className="text-muted-foreground">Powered by Trove & Endurfi protocols</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
            Trove API
          </Badge>
          <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
            Endurfi API
          </Badge>
        </div>
      </div>

      {/* Panel for Staking/Farming */}
      <Card className="gradient-card glow-effect">
        <CardHeader>
          <CardTitle>Stake or Farm Assets</CardTitle>
          <CardDescription>Earn rewards by providing liquidity or staking tokens</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 bg-secondary/50">
              <TabsTrigger
                value="farming"
                className="cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
              >
                Yield Farming
              </TabsTrigger>
              <TabsTrigger
                value="staking"
                className="cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
              >
                Staking
              </TabsTrigger>
            </TabsList>

            <TabsContent value="farming" className="space-y-4 mt-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="farm-pool">Pool</Label>
                  <Select value={selectedPool} onValueChange={setSelectedPool}>
                    <SelectTrigger className="cursor-pointer hover:bg-secondary/50 transition-colors">
                      <SelectValue placeholder="Select farming pool" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eth-strk" className="cursor-pointer">
                        ETH/STRK - 24.5% APY
                      </SelectItem>
                      <SelectItem value="usdc-eth" className="cursor-pointer">
                        USDC/ETH - 18.7% APY
                      </SelectItem>
                      <SelectItem value="strk-usdc" className="cursor-pointer">
                        STRK/USDC - 32.1% APY
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="farm-amount">LP Tokens</Label>
                  <Input
                    id="farm-amount"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="hover:border-primary/50 transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">APY</span>
                  <span className="text-primary font-medium">24.5%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lock Period</span>
                  <span>30 days</span>
                </div>
              </div>
              <Button className="w-full cursor-pointer hover:bg-primary/90 transition-colors" size="lg">
                <Zap className="mr-2 h-4 w-4" />
                Start Farming
              </Button>
            </TabsContent>

            <TabsContent value="staking" className="space-y-4 mt-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="stake-asset">Asset</Label>
                  <Select value={selectedPool} onValueChange={setSelectedPool}>
                    <SelectTrigger className="cursor-pointer hover:bg-secondary/50 transition-colors">
                      <SelectValue placeholder="Select staking asset" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="endr" className="cursor-pointer">
                        ENDR - 15.2% APY
                      </SelectItem>
                      <SelectItem value="trv" className="cursor-pointer">
                        TRV - 22.8% APY
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stake-amount">Amount</Label>
                  <Input
                    id="stake-amount"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="hover:border-primary/50 transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">APY</span>
                  <span className="text-primary font-medium">15.2%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lock Period</span>
                  <span>Flexible</span>
                </div>
              </div>
              <Button className="w-full cursor-pointer hover:bg-primary/90 transition-colors" size="lg">
                <TrendingUp className="mr-2 h-4 w-4" />
                Start Staking
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Available Pools */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gradient-card hover:glow-effect transition-all">
          <CardHeader>
            <CardTitle>Yield Farming Pools</CardTitle>
            <CardDescription>High-yield liquidity mining opportunities</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {farmingPools.map((pool, index) => (
                <div
                  key={index}
                  className="p-4 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <Zap className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">{pool.pair}</div>
                        <div className="text-sm text-muted-foreground">{pool.protocol}</div>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`
                      ${
                        pool.risk === "Low"
                          ? "bg-primary/10 text-primary"
                          : pool.risk === "Medium"
                            ? "bg-yellow-500/10 text-yellow-500"
                            : "bg-destructive/10 text-destructive"
                      }
                    `}
                    >
                      {pool.risk}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                    <div>
                      <div className="text-muted-foreground">APY</div>
                      <div className="font-bold text-primary text-lg">{pool.apy}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">TVL</div>
                      <div className="font-medium">{pool.tvl}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Multiplier</div>
                      <div className="font-medium">{pool.multiplier}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Lock Period</div>
                      <div className="font-medium">{pool.lockPeriod}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {pool.rewards.map((reward) => (
                        <Badge key={reward} variant="outline" className="text-xs">
                          {reward}
                        </Badge>
                      ))}
                    </div>
                    <Button size="sm" className="cursor-pointer hover:bg-primary/90 transition-colors">
                      Farm
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="gradient-card hover:glow-effect transition-all">
          <CardHeader>
            <CardTitle>Staking Pools</CardTitle>
            <CardDescription>Single-asset staking for steady rewards</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stakingPools.map((pool, index) => (
                <div
                  key={index}
                  className="p-4 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <TrendingUp className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">{pool.asset}</div>
                        <div className="text-sm text-muted-foreground">{pool.protocol}</div>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`
                      ${pool.risk === "Low" ? "bg-primary/10 text-primary" : "bg-yellow-500/10 text-yellow-500"}
                    `}
                    >
                      {pool.risk}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                    <div>
                      <div className="text-muted-foreground">APY</div>
                      <div className="font-bold text-primary text-lg">{pool.apy}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">TVL</div>
                      <div className="font-medium">{pool.tvl}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-muted-foreground">Lock Period</div>
                      <div className="font-medium">{pool.lockPeriod}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {pool.rewards.map((reward) => (
                        <Badge key={reward} variant="outline" className="text-xs">
                          {reward}
                        </Badge>
                      ))}
                    </div>
                    <Button size="sm" className="cursor-pointer hover:bg-primary/90 transition-colors">
                      Stake
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Your Active Farms */}
      <Card className="gradient-card hover:glow-effect transition-all">
        <CardHeader>
          <CardTitle>Your Active Positions</CardTitle>
          <CardDescription>Your current farming and staking positions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {userFarms.map((farm, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">{farm.protocol.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div>
                    <div className="font-medium">{farm.pair || farm.asset}</div>
                    <div className="text-sm text-muted-foreground">
                      {farm.staked} • {farm.apy} APY
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{farm.value}</div>
                  <div className="text-sm text-primary">+{farm.rewards} rewards</div>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{farm.timeLeft}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
