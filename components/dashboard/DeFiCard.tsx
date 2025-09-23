"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Zap, TrendingUp, Shield, Star, Sparkles, Target } from "lucide-react"

interface DeFiOpportunity {
  id: number
  title: string
  description: string
  apy: string
  protocol: string
  action: string
  risk: "low" | "medium" | "high"
  tvl: string
  rewards: string
  duration: string
}

interface DeFiCardProps {
  opportunities: DeFiOpportunity[]
}

export function DeFiCard({ opportunities }: DeFiCardProps) {
  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "low":
        return { bg: "rgba(16, 185, 129, 0.2)", text: "#10b981", icon: "🛡️" }
      case "medium":
        return { bg: "rgba(245, 158, 11, 0.2)", text: "#f59e0b", icon: "⚠️" }
      case "high":
        return { bg: "rgba(239, 68, 68, 0.2)", text: "#ef4444", icon: "🚨" }
      default:
        return { bg: "rgba(107, 114, 128, 0.2)", text: "#6b7280", icon: "❓" }
    }
  }

  const getProtocolIcon = (protocol: string) => {
    switch (protocol.toLowerCase()) {
      case "starknet":
        return "🌟"
      case "uniswap v3":
        return "🔄"
      case "aave":
        return "🏦"
      case "compound":
        return "💰"
      case "curve":
        return "📈"
      default:
        return "⚡"
    }
  }

  return (
    <Card
      className="glassmorphism hover:scale-105 transition-all duration-500 relative overflow-hidden group"
      style={{
        backgroundColor: 'rgba(20, 20, 20, 0.9)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#ffffff'
      }}
    >
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-green-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <CardHeader>
        <CardTitle className="flex items-center space-x-3" style={{ color: '#ffffff' }}>
          <div className="relative">
            <Zap className="w-6 h-6" style={{ color: '#00d084' }} />
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
          </div>
          <span>DeFi Opportunities</span>
          <div className="ml-auto flex space-x-1">
            <Sparkles className="w-4 h-4 text-yellow-400 animate-spin" style={{ animationDuration: '3s' }} />
            <Star className="w-4 h-4 text-green-400 animate-bounce" style={{ animationDelay: '0.5s' }} />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {opportunities.map((opportunity, index) => (
            <div
              key={opportunity.id}
              className="p-5 rounded-xl border hover:scale-102 transition-all duration-300 relative overflow-hidden group/item cursor-pointer"
              style={{
                backgroundColor: 'rgba(26, 26, 26, 0.5)',
                borderColor: 'rgba(0, 208, 132, 0.2)'
              }}
            >
              {/* Gradient background on hover */}
              <div className="absolute inset-0 bg-gradient-to-r from-green-500/10 via-purple-500/10 to-blue-500/10 opacity-0 group-hover/item:opacity-100 transition-opacity duration-300" />

              {/* Floating elements */}
              <div className="absolute top-2 right-2 w-2 h-2 bg-green-400 rounded-full opacity-0 group-hover/item:opacity-60 animate-ping" />
              <div className="absolute bottom-2 left-2 w-1 h-1 bg-purple-400 rounded-full opacity-0 group-hover/item:opacity-40 animate-bounce" style={{ animationDelay: '0.3s' }} />

              <div className="relative z-10">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className="text-2xl">{getProtocolIcon(opportunity.protocol)}</div>
                    <div>
                      <h4 className="font-bold text-lg" style={{ color: '#ffffff' }}>{opportunity.title}</h4>
                      <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '13px', marginTop: '4px' }}>
                        {opportunity.description}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge
                      className="text-sm font-bold mb-2 animate-pulse"
                      style={{
                        backgroundColor: 'rgba(0, 208, 132, 0.3)',
                        color: '#00d084',
                        border: '1px solid rgba(0, 208, 132, 0.5)'
                      }}
                    >
                      {opportunity.apy} APY
                    </Badge>
                    <div className="text-xs" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                      TVL: {opportunity.tvl}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <Badge
                      className="text-xs"
                      style={{
                        backgroundColor: getRiskColor(opportunity.risk).bg,
                        color: getRiskColor(opportunity.risk).text
                      }}
                    >
                      {getRiskColor(opportunity.risk).icon} {opportunity.risk.toUpperCase()}
                    </Badge>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' }}>
                      {opportunity.duration}
                    </span>
                  </div>
                  <div className="text-right">
                    <div style={{ color: '#00d084', fontSize: '12px', fontWeight: 'bold' }}>
                      {opportunity.rewards}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Target className="w-4 h-4" style={{ color: '#00d084' }} />
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' }}>{opportunity.protocol}</span>
                  </div>
                  <Button
                    size="sm"
                    className="text-sm font-bold hover:scale-105 transition-transform duration-200 relative overflow-hidden group/btn"
                    style={{
                      backgroundColor: '#00d084',
                      color: '#000000',
                      border: 'none'
                    }}
                  >
                    <span className="relative z-10">{opportunity.action}</span>
                    <div className="absolute inset-0 bg-white opacity-0 group-hover/btn:opacity-20 transition-opacity duration-200" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}