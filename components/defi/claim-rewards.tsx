"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Gift, Clock, Zap, CheckCircle } from "lucide-react"

const pendingRewards = [
  {
    protocol: "Vesu",
    type: "Lending",
    asset: "ETH",
    amount: "0.125 ETH",
    value: "$312.50",
    apy: "4.2%",
    nextClaim: "2 days",
    claimable: true,
  },
  {
    protocol: "Trove",
    type: "Farming",
    asset: "STRK",
    amount: "245.7 STRK",
    value: "$147.42",
    apy: "24.5%",
    nextClaim: "5 days",
    claimable: true,
  },
  {
    protocol: "Trove",
    type: "Farming",
    asset: "TRV",
    amount: "89.3 TRV",
    value: "$178.60",
    apy: "24.5%",
    nextClaim: "5 days",
    claimable: true,
  },
  {
    protocol: "Endurfi",
    type: "Staking",
    asset: "ENDR",
    amount: "156.8 ENDR",
    value: "$50.18",
    apy: "15.2%",
    nextClaim: "Available",
    claimable: true,
  },
  {
    protocol: "Endurfi",
    type: "Farming",
    asset: "ETH",
    amount: "0.045 ETH",
    value: "$112.50",
    apy: "18.7%",
    nextClaim: "12 hours",
    claimable: false,
  },
]

const rewardHistory = [
  {
    date: "2024-09-18",
    protocol: "Vesu",
    asset: "ETH",
    amount: "0.098 ETH",
    value: "$245.00",
    txHash: "0x1234...5678",
  },
  {
    date: "2024-09-15",
    protocol: "Trove",
    asset: "STRK",
    amount: "189.4 STRK",
    value: "$113.64",
    txHash: "0x2345...6789",
  },
  {
    date: "2024-09-12",
    protocol: "Endurfi",
    asset: "ENDR",
    amount: "234.6 ENDR",
    value: "$75.07",
    txHash: "0x3456...7890",
  },
]

export function ClaimRewards() {
  const [selectedRewards, setSelectedRewards] = useState<number[]>([])
  const [claiming, setClaiming] = useState(false)

  const totalClaimableValue = pendingRewards
    .filter((reward, index) => reward.claimable && selectedRewards.includes(index))
    .reduce((sum, reward) => sum + Number.parseFloat(reward.value.replace("$", "").replace(",", "")), 0)

  const handleSelectReward = (index: number) => {
    if (!pendingRewards[index].claimable) return

    setSelectedRewards((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]))
  }

  const handleClaimAll = async () => {
    setClaiming(true)
    // Simulate claiming process....
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setSelectedRewards([])
    setClaiming(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-balance">Claim Rewards</h2>
          <p className="text-muted-foreground">Withdraw your earned staking and yield rewards</p>
        </div>
        <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
          Total: $
          {pendingRewards
            .reduce((sum, r) => sum + Number.parseFloat(r.value.replace("$", "").replace(",", "")), 0)
            .toFixed(2)}
        </Badge>
      </div>

      {/* Claim Summary */}
      <Card className="gradient-card glow-effect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            Claimable Rewards
          </CardTitle>
          <CardDescription>Select rewards to claim in a single transaction</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-2xl font-bold text-primary">${totalClaimableValue.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">
                {selectedRewards.length} reward{selectedRewards.length !== 1 ? "s" : ""} selected
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setSelectedRewards(pendingRewards.map((_, i) => i).filter((i) => pendingRewards[i].claimable))
                }
                disabled={claiming}
              >
                Select All
              </Button>
              <Button
                onClick={handleClaimAll}
                disabled={selectedRewards.length === 0 || claiming}
                className="min-w-[120px]"
              >
                {claiming ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Claiming...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Claim Selected
                  </>
                )}
              </Button>
            </div>
          </div>

          {selectedRewards.length > 0 && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
              <div className="text-sm text-primary">
                Gas optimization: Claiming {selectedRewards.length} rewards in one transaction saves ~$
                {(selectedRewards.length * 2.5).toFixed(2)} in fees
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Rewards */}
      <Card className="gradient-card">
        <CardHeader>
          <CardTitle>Pending Rewards</CardTitle>
          <CardDescription>Your accumulated rewards across all protocols</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pendingRewards.map((reward, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border cursor-pointer transition-all ${
                  reward.claimable
                    ? selectedRewards.includes(index)
                      ? "bg-primary/10 border-primary/50"
                      : "bg-secondary/50 border-border hover:border-primary/30"
                    : "bg-muted/30 border-muted cursor-not-allowed opacity-60"
                }`}
                onClick={() => handleSelectReward(index)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      {reward.claimable && selectedRewards.includes(index) && (
                        <CheckCircle className="h-4 w-4 text-primary" />
                      )}
                      <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">
                          {reward.protocol.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">{reward.protocol}</div>
                      <div className="text-sm text-muted-foreground">
                        {reward.type} • {reward.asset}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-medium">{reward.value}</div>
                    <div className="text-sm text-muted-foreground">{reward.amount}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    {reward.claimable ? (
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        Ready
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {reward.nextClaim}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Reward History */}
      <Card className="gradient-card">
        <CardHeader>
          <CardTitle>Recent Claims</CardTitle>
          <CardDescription>Your reward claim history</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {rewardHistory.map((claim, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border"
              >
                <div className="flex items-center gap-4">
                  <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium">{claim.protocol}</div>
                    <div className="text-sm text-muted-foreground">{claim.date}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{claim.value}</div>
                  <div className="text-sm text-muted-foreground">{claim.amount}</div>
                </div>
                <div className="text-xs text-muted-foreground font-mono">{claim.txHash}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
