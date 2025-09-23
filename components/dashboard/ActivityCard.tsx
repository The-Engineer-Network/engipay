"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, ArrowUpRight, ArrowLeftRight, Target, ArrowDownLeft, Zap, Activity } from "lucide-react"

interface Activity {
  id: number
  type: "payment" | "swap" | "lending" | "staking" | "airdrop"
  description: string
  amount: string
  time: string
  status: "completed" | "active" | "pending"
  network?: string
  txHash?: string
}

interface ActivityCardProps {
  activities: Activity[]
}

export function ActivityCard({ activities }: ActivityCardProps) {
  const getActivityIcon = (type: string) => {
    switch (type) {
      case "payment":
        return <ArrowUpRight className="w-5 h-5" />
      case "swap":
        return <ArrowLeftRight className="w-5 h-5" />
      case "lending":
        return <Target className="w-5 h-5" />
      case "staking":
        return <Zap className="w-5 h-5" />
      case "airdrop":
        return <ArrowDownLeft className="w-5 h-5" />
      default:
        return <Activity className="w-5 h-5" />
    }
  }

  const getActivityColor = (type: string) => {
    switch (type) {
      case "payment":
        return "#3b82f6"
      case "swap":
        return "#8b5cf6"
      case "lending":
        return "#00d084"
      case "staking":
        return "#f59e0b"
      case "airdrop":
        return "#ec4899"
      default:
        return "#6b7280"
    }
  }

  const getActivityGradient = (type: string) => {
    switch (type) {
      case "payment":
        return "from-blue-500/20 to-blue-600/20"
      case "swap":
        return "from-purple-500/20 to-purple-600/20"
      case "lending":
        return "from-green-500/20 to-green-600/20"
      case "staking":
        return "from-yellow-500/20 to-orange-600/20"
      case "airdrop":
        return "from-pink-500/20 to-pink-600/20"
      default:
        return "from-gray-500/20 to-gray-600/20"
    }
  }

  const getAmountColor = (amount: string) => {
    if (amount.startsWith("+")) return "#10b981"
    if (amount.startsWith("-")) return "#ef4444"
    return "#ffffff"
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return { bg: "#00d084", text: "#000000" }
      case "active":
        return { bg: "#3b82f6", text: "#ffffff" }
      case "pending":
        return { bg: "#f59e0b", text: "#000000" }
      default:
        return { bg: "rgba(26, 26, 26, 0.8)", text: "#ffffff" }
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
      <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <CardHeader>
        <CardTitle className="flex items-center space-x-3" style={{ color: '#ffffff' }}>
          <div className="relative">
            <Clock className="w-6 h-6" style={{ color: '#00d084' }} />
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          </div>
          <span>Recent Activity</span>
          <div className="ml-auto">
            <Badge className="bg-green-500/20 text-green-300 border-green-500/30 animate-pulse">
              Live
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity, index) => (
            <div
              key={activity.id}
              className="flex items-center justify-between p-4 rounded-xl border hover:scale-102 transition-all duration-300 relative overflow-hidden group/item"
              style={{
                backgroundColor: 'rgba(26, 26, 26, 0.5)',
                borderColor: 'rgba(0, 208, 132, 0.2)'
              }}
            >
              {/* Activity type gradient background */}
              <div className={`absolute inset-0 bg-gradient-to-r ${getActivityGradient(activity.type)} opacity-0 group-hover/item:opacity-100 transition-opacity duration-300`} />

              <div className="flex items-center space-x-4 relative z-10">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg animate-pulse"
                  style={{
                    backgroundColor: 'rgba(26, 26, 26, 0.8)',
                    color: getActivityColor(activity.type),
                    boxShadow: `0 0 20px ${getActivityColor(activity.type)}40`
                  }}
                >
                  {getActivityIcon(activity.type)}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm" style={{ color: '#ffffff' }}>{activity.description}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' }}>{activity.time}</p>
                    {activity.network && (
                      <Badge variant="outline" className="text-xs bg-purple-500/20 text-purple-300 border-purple-500/30">
                        {activity.network}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-right relative z-10">
                <p
                  className="font-bold text-lg"
                  style={{ color: getAmountColor(activity.amount) }}
                >
                  {activity.amount}
                </p>
                <Badge
                  className="text-xs mt-1"
                  style={{
                    backgroundColor: getStatusColor(activity.status).bg,
                    color: getStatusColor(activity.status).text
                  }}
                >
                  {activity.status}
                </Badge>
              </div>

              {/* Floating animation elements */}
              <div className="absolute top-2 right-2 w-2 h-2 bg-green-400 rounded-full opacity-0 group-hover/item:opacity-60 animate-ping" />
              <div className="absolute bottom-2 left-2 w-1 h-1 bg-blue-400 rounded-full opacity-0 group-hover/item:opacity-40 animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}