"use client"

import { Button } from "@/components/ui/button"
import { ArrowUpRight, ArrowDownLeft, ArrowLeftRight, CreditCard, Zap, Sparkles } from "lucide-react"

interface QuickActionsProps {
  onAction?: (action: string) => void
}

export function QuickActions({ onAction }: QuickActionsProps) {
  const actions = [
    {
      icon: <ArrowUpRight className="w-8 h-8" />,
      label: "Send",
      color: "#00d084",
      gradient: "from-green-400 to-emerald-500",
      description: "Instant transfers",
      glowColor: "rgba(0, 208, 132, 0.3)"
    },
    {
      icon: <ArrowDownLeft className="w-8 h-8" />,
      label: "Receive",
      color: "#00d084",
      gradient: "from-blue-400 to-cyan-500",
      description: "Get paid easily",
      glowColor: "rgba(59, 130, 246, 0.3)"
    },
    {
      icon: <ArrowLeftRight className="w-8 h-8" />,
      label: "Swap",
      color: "#00d084",
      gradient: "from-purple-400 to-pink-500",
      description: "Cross-chain swaps",
      glowColor: "rgba(147, 51, 234, 0.3)"
    },
    {
      icon: <CreditCard className="w-8 h-8" />,
      label: "Pay Merchant",
      color: "#00d084",
      gradient: "from-orange-400 to-red-500",
      description: "Pay anywhere",
      glowColor: "rgba(249, 115, 22, 0.3)"
    }
  ]

  const handleAction = (action: string) => {
    onAction?.(action)
  }

  return (
    <div className="mb-8">
      <div className="flex items-center space-x-3 mb-6">
        <h2 className="text-2xl font-bold">Quick Actions</h2>
        <div className="flex space-x-1">
          <Sparkles className="w-5 h-5 text-yellow-400 animate-pulse" />
          <Zap className="w-5 h-5 text-green-400 animate-bounce" style={{ animationDelay: '0.2s' }} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
        {actions.map((action, index) => (
          <Button
            key={action.label}
            onClick={() => handleAction(action.label)}
            className="h-20 sm:h-24 flex flex-col items-center justify-center space-y-2 sm:space-y-3 hover:scale-110 hover:-rotate-1 transition-all duration-300 border-2 relative overflow-hidden group px-2"
            style={{
              backgroundColor: 'rgba(0, 208, 132, 0.1)',
              borderColor: action.glowColor,
              color: action.color
            }}
          >
            {/* Animated background glow */}
            <div
              className={`absolute inset-0 bg-gradient-to-br ${action.gradient} opacity-0 group-hover:opacity-20 transition-opacity duration-300`}
            />

            {/* Floating particles */}
            <div className="absolute top-2 right-2 w-2 h-2 bg-green-400 rounded-full opacity-0 group-hover:opacity-60 animate-ping" />
            <div className="absolute bottom-2 left-2 w-1 h-1 bg-purple-400 rounded-full opacity-0 group-hover:opacity-40 animate-bounce" style={{ animationDelay: '0.3s' }} />

            <div
              className="relative z-10 transform group-hover:scale-110 transition-transform duration-300"
              style={{ color: action.color }}
            >
              {action.icon}
            </div>

            <div className="relative z-10 text-center">
              <span className="font-bold text-xs sm:text-sm block leading-tight">{action.label}</span>
              <span className="text-xs opacity-70 hidden sm:block">{action.description}</span>
            </div>

            {/* Ripple effect on hover */}
            <div className="absolute inset-0 rounded-lg bg-white opacity-0 group-hover:opacity-10 group-hover:animate-ping transition-opacity duration-300" />
          </Button>
        ))}
      </div>
    </div>
  )
}