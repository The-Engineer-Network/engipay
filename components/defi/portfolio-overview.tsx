"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TrendingUp, DollarSign, Percent, Eye, EyeOff, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useWallet } from "@/contexts/WalletContext"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

export function PortfolioOverview() {
  const [hideBalances, setHideBalances] = useState(false)
  const [portfolioData, setPortfolioData] = useState<any[]>([])
  const [assetData, setAssetData] = useState<any[]>([])
  const [positions, setPositions] = useState<any[]>([])
  const [totalValue, setTotalValue] = useState("0")
  const [totalAPY, setTotalAPY] = useState("0")
  const [activePositions, setActivePositions] = useState(0)
  const [pendingRewards, setPendingRewards] = useState("0")
  const [loading, setLoading] = useState(false)
  
  const { toast } = useToast()
  const { walletAddress } = useWallet()

  useEffect(() => {
    if (walletAddress) {
      loadPortfolioData()
    }
  }, [walletAddress])

  const loadPortfolioData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/api/portfolio/overview/${walletAddress}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })
      const data = await response.json()
      
      if (data.success) {
        setTotalValue(data.totalValue || "0")
        setTotalAPY(data.averageAPY || "0")
        setActivePositions(data.activePositions || 0)
        setPendingRewards(data.pendingRewards || "0")
        setPortfolioData(data.historicalData || [])
        setAssetData(data.assetAllocation || [])
        setPositions(data.positions || [])
      }
    } catch (error) {
      console.error('Error loading portfolio:', error)
      toast({
        title: "Error",
        description: "Failed to load portfolio data",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Portfolio Summary */}
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        <Card className="gradient-card hover:glow-effect transition-all cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Portfolio Value</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHideBalances(!hideBalances)}
              className="h-8 w-8 p-0 cursor-pointer hover:bg-primary/10 transition-colors"
            >
              {hideBalances ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-primary">{hideBalances ? "••••••" : `$${totalValue}`}</div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingUp className="mr-1 h-3 w-3 text-primary" />
              {loading ? "Loading..." : "Updated just now"}
            </div>
          </CardContent>
        </Card>

        <Card className="gradient-card hover:glow-effect transition-all cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total APY</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-primary">{totalAPY}%</div>
            <p className="text-xs text-muted-foreground">Weighted average</p>
          </CardContent>
        </Card>

        <Card className="gradient-card hover:glow-effect transition-all cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Positions</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{activePositions}</div>
            <p className="text-xs text-muted-foreground">Across multiple protocols</p>
          </CardContent>
        </Card>

        <Card className="gradient-card hover:glow-effect transition-all cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Rewards</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-primary">{hideBalances ? "••••" : `$${pendingRewards}`}</div>
            <p className="text-xs text-muted-foreground">Ready to claim</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gradient-card hover:glow-effect transition-all">
          <CardHeader>
            <CardTitle>Portfolio Performance</CardTitle>
            <CardDescription>Your portfolio value over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={portfolioData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.2 0.02 240)" />
                <XAxis dataKey="name" stroke="oklch(0.65 0.02 240)" />
                <YAxis stroke="oklch(0.65 0.02 240)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "oklch(0.12 0.02 240)",
                    border: "1px solid oklch(0.2 0.02 240)",
                    borderRadius: "8px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="oklch(0.7 0.15 160)"
                  strokeWidth={3}
                  dot={{ fill: "oklch(0.7 0.15 160)", strokeWidth: 2, r: 4 }}
                />
              </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="gradient-card hover:glow-effect transition-all">
          <CardHeader>
            <CardTitle>Asset Allocation</CardTitle>
            <CardDescription>Distribution of your portfolio</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={assetData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={120}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {assetData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {assetData.map((asset) => (
                    <div key={asset.name} className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: asset.color }} />
                      <span className="text-sm">
                        {asset.name} {asset.value}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Positions */}
      <Card className="gradient-card hover:glow-effect transition-all">
        <CardHeader>
          <CardTitle>Active Positions</CardTitle>
          <CardDescription>Your current DeFi positions across protocols</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {!walletAddress ? (
              <div className="text-center p-8 text-muted-foreground">
                Connect your wallet to view your positions
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : positions.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground">
                No active positions. Start lending, staking, or farming to see your positions here.
              </div>
            ) : positions.map((position, index) => (
              <div
                key={index}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors cursor-pointer gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">
                      {position.protocol.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium">{position.protocol}</div>
                    <div className="text-sm text-muted-foreground">
                      {position.type} • {position.asset}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-4">
                  <div className="text-right">
                    <div className="font-medium">{hideBalances ? "••••••" : position.value}</div>
                    <div className="text-sm text-muted-foreground">
                      {position.amount} • {position.apy} APY
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      {position.status}
                    </Badge>
                    <span className="text-sm text-primary">{position.change}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
