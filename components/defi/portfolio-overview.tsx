"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TrendingUp, DollarSign, Percent, Eye, EyeOff } from "lucide-react"
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

const portfolioData = [
  { name: "Jul", value: 2800 },
  { name: "Aug", value: 3200 },
  { name: "Sep", value: 2950 },
  { name: "Oct", value: 3800 },
  { name: "Nov", value: 4200 },
]

const assetData = [
  { name: "ETH", value: 40, color: "#00D2FF" },
  { name: "STRK", value: 30, color: "#00FF88" },
  { name: "USDC", value: 25, color: "#FFB800" },
  { name: "Others", value: 5, color: "#8B5CF6" },
]

const positions = [
  {
    protocol: "Vesu",
    asset: "ETH",
    type: "Lending",
    amount: "0.85 ETH",
    apy: "4.2%",
    value: "$1,680",
    status: "Active",
    change: "+2.1%",
  },
  {
    protocol: "Trove",
    asset: "STRK",
    type: "Staking",
    amount: "2,400 STRK",
    apy: "12.8%",
    value: "$1,260",
    status: "Active",
    change: "+5.3%",
  },
  {
    protocol: "Endurfi",
    asset: "USDC",
    type: "Yield Farming",
    amount: "1,050 USDC",
    apy: "8.9%",
    value: "$1,050",
    status: "Active",
    change: "+1.2%",
  },
]

export function PortfolioOverview() {
  const [hideBalances, setHideBalances] = useState(false)

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
            <div className="text-xl sm:text-2xl font-bold text-primary">{hideBalances ? "••••••" : "$4,200"}</div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingUp className="mr-1 h-3 w-3 text-primary" />
              +12.5% from last month
            </div>
          </CardContent>
        </Card>

        <Card className="gradient-card hover:glow-effect transition-all cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total APY</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-primary">8.6%</div>
            <p className="text-xs text-muted-foreground">Weighted average</p>
          </CardContent>
        </Card>

        <Card className="gradient-card hover:glow-effect transition-all cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Positions</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">3</div>
            <p className="text-xs text-muted-foreground">Across 3 protocols</p>
          </CardContent>
        </Card>

        <Card className="gradient-card hover:glow-effect transition-all cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Rewards</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-primary">{hideBalances ? "••••" : "$127"}</div>
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
            {positions.map((position, index) => (
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
