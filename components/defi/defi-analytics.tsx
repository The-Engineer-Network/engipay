"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { TrendingUp, TrendingDown, DollarSign, Activity, PieChart, Loader2, RefreshCw } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { useToast } from "@/hooks/use-toast"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts"

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'

interface PositionAnalytics {
  positionId: string
  poolAddress: string
  collateralAsset: string
  debtAsset: string
  collateralValue: string
  debtValue: string
  netValue: string
  healthFactor: string | null
  yieldEarned: string
  currentAPY: string
  status: string
}

interface PortfolioAnalytics {
  totalValueLocked: string
  totalDebt: string
  netValue: string
  totalYieldEarned: string
  averageAPY: string
  positionCount: number
  healthScore: number
  riskLevel: string
  minHealthFactor: number | null
  positions: PositionAnalytics[]
}

interface RiskMetrics {
  overallRisk: string
  diversificationScore: number
  concentrationRisk: string
  liquidationRisk: string
  positionsAtRisk: number
  positionsCritical: number
  positionsLiquidatable: number
  assetExposure: Record<string, number>
  protocolExposure: Record<string, number>
  recommendations: string[]
}

interface YieldPerformance {
  totalYield: string
  dailyYield: Array<{ date: string; yield: string }>
  bestPerformingPosition: any
  worstPerformingPosition: any
}

interface ProtocolAnalytics {
  totalValueLocked: string
  totalBorrowed: string
  utilizationRate: string
  averageSupplyAPY: string
  averageBorrowAPY: string
  totalPools: number
  totalPositions: number
  transactions24h: number
  healthDistribution: {
    healthy: number
    atRisk: number
    critical: number
    liquidatable: number
  }
}

interface DashboardData {
  portfolio: PortfolioAnalytics
  risk: RiskMetrics
  yield: YieldPerformance
  protocol: ProtocolAnalytics
}

export function DeFiAnalytics() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [timeframe, setTimeframe] = useState("30d")
  
  const { walletAddress } = useWallet()
  const { toast } = useToast()

  useEffect(() => {
    if (walletAddress) {
      loadAnalytics()
    }
  }, [walletAddress])

  const loadAnalytics = async () => {
    if (!walletAddress) return
    
    setLoading(true)
    try {
      // Get authentication token from localStorage
      const token = localStorage.getItem('token')
      if (!token) {
        toast({
          title: "Authentication Required",
          description: "Please log in to view analytics",
          variant: "destructive"
        })
        return
      }

      const response = await fetch(`${API_URL}/analytics/dashboard`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      const data = await response.json()
      
      if (data.success) {
        setDashboardData(data.data)
      } else {
        throw new Error(data.error || 'Failed to load analytics')
      }
    } catch (error) {
      console.error('Error loading analytics:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load DeFi analytics",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num)
  }

  const formatPercent = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value
    return `${num.toFixed(2)}%`
  }

  if (!walletAddress) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Connect your wallet to view analytics</p>
        </CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading analytics...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">DeFi Analytics</h2>
          <p className="text-muted-foreground">Track your DeFi portfolio performance</p>
        </div>
        <Button onClick={loadAnalytics} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid md:grid-cols-4 gap-4">
        <Card className="gradient-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Total Value Locked</p>
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
            <p className="text-2xl font-bold">
              {dashboardData ? formatCurrency(dashboardData.portfolio.totalValueLocked) : "$0.00"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {dashboardData?.portfolio.positionCount || 0} active positions
            </p>
          </CardContent>
        </Card>

        <Card className="gradient-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Total Debt</p>
              <TrendingDown className="h-4 w-4 text-red-500" />
            </div>
            <p className="text-2xl font-bold">
              {dashboardData ? formatCurrency(dashboardData.portfolio.totalDebt) : "$0.00"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Borrowed amount</p>
          </CardContent>
        </Card>

        <Card className="gradient-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Net Value</p>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </div>
            <p className="text-2xl font-bold text-green-500">
              {dashboardData ? formatCurrency(dashboardData.portfolio.netValue) : "$0.00"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Total - Debt</p>
          </CardContent>
        </Card>

        <Card className="gradient-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Average APY</p>
              <Activity className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-2xl font-bold text-green-500">
              {dashboardData ? formatPercent(dashboardData.portfolio.averageAPY) : "0.00%"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Weighted average</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Active Positions</CardTitle>
            <CardDescription>Your DeFi positions across protocols</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {dashboardData?.portfolio.positions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No active positions</p>
              ) : (
                dashboardData?.portfolio.positions.map((position, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <PieChart className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">{position.collateralAsset}</div>
                        <div className="text-sm text-muted-foreground">
                          Collateral • {position.debtAsset} Debt
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{formatCurrency(position.netValue)}</div>
                      <div className="text-sm text-green-500">{formatPercent(position.currentAPY)} APY</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Yield Performance</CardTitle>
            <CardDescription>Total rewards earned over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-secondary/50 border">
                <div className="text-sm text-muted-foreground mb-1">Total Yield Earned</div>
                <div className="text-3xl font-bold text-green-500">
                  {dashboardData ? formatCurrency(dashboardData.portfolio.totalYieldEarned) : "$0.00"}
                </div>
              </div>
              {dashboardData?.yield.dailyYield && dashboardData.yield.dailyYield.length > 0 && (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={dashboardData.yield.dailyYield.slice(-7)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="yield" stroke="#10b981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Protocol Statistics */}
      <Card>
        <CardHeader>
          <CardTitle>Protocol Statistics</CardTitle>
          <CardDescription>Platform-wide DeFi metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-secondary/50 border">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Total TVL</span>
                <Badge variant="secondary">Platform</Badge>
              </div>
              <p className="text-2xl font-bold mb-1">
                {dashboardData ? formatCurrency(dashboardData.protocol.totalValueLocked) : "$0.00"}
              </p>
              <p className="text-sm text-muted-foreground">
                {dashboardData?.protocol.totalPools || 0} active pools
              </p>
            </div>

            <div className="p-4 rounded-lg bg-secondary/50 border">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Total Borrowed</span>
                <Badge variant="secondary">Platform</Badge>
              </div>
              <p className="text-2xl font-bold mb-1">
                {dashboardData ? formatCurrency(dashboardData.protocol.totalBorrowed) : "$0.00"}
              </p>
              <p className="text-sm text-muted-foreground">
                {dashboardData ? formatPercent(dashboardData.protocol.utilizationRate) : "0%"} utilization
              </p>
            </div>

            <div className="p-4 rounded-lg bg-secondary/50 border">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Avg Supply APY</span>
                <Badge variant="secondary">Platform</Badge>
              </div>
              <p className="text-2xl font-bold mb-1 text-green-500">
                {dashboardData ? formatPercent(dashboardData.protocol.averageSupplyAPY) : "0.00%"}
              </p>
              <p className="text-sm text-muted-foreground">
                {dashboardData?.protocol.totalPositions || 0} positions
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Health & Risk Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Health & Risk Metrics</CardTitle>
          <CardDescription>Monitor your portfolio health and risk exposure</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-6">
            <div>
              <div className="text-sm text-muted-foreground mb-2">Health Score</div>
              <div className="flex items-center gap-2">
                <div className={`text-3xl font-bold ${
                  (dashboardData?.portfolio.healthScore || 0) >= 80 ? 'text-green-500' :
                  (dashboardData?.portfolio.healthScore || 0) >= 50 ? 'text-yellow-500' :
                  'text-red-500'
                }`}>
                  {dashboardData?.portfolio.healthScore || 0}/100
                </div>
                <Badge variant={
                  (dashboardData?.portfolio.healthScore || 0) >= 80 ? 'default' :
                  (dashboardData?.portfolio.healthScore || 0) >= 50 ? 'secondary' :
                  'destructive'
                }>
                  {(dashboardData?.portfolio.healthScore || 0) >= 80 ? 'Healthy' :
                   (dashboardData?.portfolio.healthScore || 0) >= 50 ? 'Moderate' :
                   'At Risk'}
                </Badge>
              </div>
              {dashboardData?.portfolio.minHealthFactor && (
                <p className="text-xs text-muted-foreground mt-2">
                  Min Health Factor: {dashboardData.portfolio.minHealthFactor.toFixed(2)}
                </p>
              )}
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-2">Diversification Score</div>
              <div className="text-3xl font-bold text-blue-500">
                {dashboardData?.risk.diversificationScore || 0}/100
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {dashboardData?.risk.concentrationRisk || 'low'} concentration risk
              </p>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-2">Risk Level</div>
              <div className="flex items-center gap-2">
                <div className={`text-3xl font-bold capitalize ${
                  dashboardData?.portfolio.riskLevel === 'low' ? 'text-green-500' :
                  dashboardData?.portfolio.riskLevel === 'medium' ? 'text-yellow-500' :
                  dashboardData?.portfolio.riskLevel === 'high' ? 'text-orange-500' :
                  'text-red-500'
                }`}>
                  {dashboardData?.portfolio.riskLevel || 'none'}
                </div>
                <Badge variant={
                  dashboardData?.portfolio.riskLevel === 'low' ? 'default' :
                  dashboardData?.portfolio.riskLevel === 'medium' ? 'secondary' :
                  'destructive'
                }>
                  {dashboardData?.risk.liquidationRisk || 'none'}
                </Badge>
              </div>
            </div>
          </div>

          {/* Risk Recommendations */}
          {dashboardData?.risk.recommendations && dashboardData.risk.recommendations.length > 0 && (
            <div className="mt-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Risk Recommendations
              </h4>
              <ul className="space-y-1">
                {dashboardData.risk.recommendations.map((rec, index) => (
                  <li key={index} className="text-sm text-muted-foreground">
                    • {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Position Risk Distribution */}
          {dashboardData?.protocol.healthDistribution && (
            <div className="mt-6">
              <h4 className="font-medium mb-3">Position Health Distribution</h4>
              <div className="grid grid-cols-4 gap-2">
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                  <div className="text-2xl font-bold text-green-500">
                    {dashboardData.protocol.healthDistribution.healthy}
                  </div>
                  <div className="text-xs text-muted-foreground">Healthy</div>
                </div>
                <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-center">
                  <div className="text-2xl font-bold text-yellow-500">
                    {dashboardData.protocol.healthDistribution.atRisk}
                  </div>
                  <div className="text-xs text-muted-foreground">At Risk</div>
                </div>
                <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-center">
                  <div className="text-2xl font-bold text-orange-500">
                    {dashboardData.protocol.healthDistribution.critical}
                  </div>
                  <div className="text-xs text-muted-foreground">Critical</div>
                </div>
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
                  <div className="text-2xl font-bold text-red-500">
                    {dashboardData.protocol.healthDistribution.liquidatable}
                  </div>
                  <div className="text-xs text-muted-foreground">Liquidatable</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
