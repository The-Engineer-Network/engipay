"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

interface BalanceCardProps {
  symbol: string
  name: string
  balance: string
  value: string
  change: string
  icon: string
  trend: "up" | "down" | "stable"
  volume: string
}

export function BalanceCard({ symbol, name, balance, value, change, icon, trend, volume }: BalanceCardProps) {
  const getAssetColor = (symbol: string) => {
    switch (symbol) {
      case "STRK":
        return "rgba(59, 130, 246, 0.2)"
      case "ETH":
        return "rgba(147, 51, 234, 0.2)"
      case "BTC":
        return "rgba(249, 115, 22, 0.2)"
      case "USDT":
        return "rgba(16, 185, 129, 0.2)"
      default:
        return "rgba(0, 208, 132, 0.2)"
    }
  }

  const getChangeColor = (change: string) => {
    if (change.startsWith("+")) return "#10b981"
    if (change.startsWith("-")) return "#ef4444"
    return "rgba(255, 255, 255, 0.7)"
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "up":
        return <TrendingUp className="w-4 h-4" />
      case "down":
        return <TrendingDown className="w-4 h-4" />
      default:
        return <Minus className="w-4 h-4" />
    }
  }

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case "up":
        return "#10b981"
      case "down":
        return "#ef4444"
      default:
        return "rgba(255, 255, 255, 0.7)"
    }
  }

  return (
    <Card
      className="hover:scale-105 hover:rotate-1 transition-all duration-500 hover:shadow-2xl hover:shadow-green-500/20 group cursor-pointer"
      style={{
        backgroundColor: 'rgba(20, 20, 20, 0.9)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#ffffff'
      }}
    >
      <CardContent className="p-6 relative overflow-hidden">
        {/* Animated background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        {/* Floating particles effect */}
        <div className="absolute top-2 right-2 w-2 h-2 bg-green-400 rounded-full opacity-60 animate-pulse" />
        <div className="absolute bottom-4 left-4 w-1 h-1 bg-purple-400 rounded-full opacity-40 animate-bounce" style={{ animationDelay: '0.5s' }} />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-2xl animate-pulse"
                style={{ backgroundColor: getAssetColor(symbol) }}
              >
                {icon}
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-bold" style={{ color: '#ffffff' }}>{symbol}</h3>
                <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '11px sm:12px' }}>{name}</p>
              </div>
            </div>
            <div
              className="flex items-center space-x-1"
              style={{ color: getTrendColor(trend) }}
            >
              {getTrendIcon(trend)}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-2xl sm:text-3xl font-bold mb-1" style={{ color: '#ffffff' }}>{balance}</div>
              <div style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px sm:14px' }}>{value}</div>
            </div>

            <div className="flex items-center justify-between">
              <div
                className="text-sm font-semibold flex items-center space-x-1"
                style={{ color: getChangeColor(change) }}
              >
                <span>{change}</span>
              </div>
              <Badge
                variant="secondary"
                className="text-xs bg-green-500/20 text-green-300 border-green-500/30"
              >
                {volume}
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}