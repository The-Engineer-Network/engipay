export interface Balance {
  symbol: string
  name: string
  balance: string
  value: string
  change: string
  icon: string
  trend: "up" | "down" | "stable"
  volume: string
}

export interface Activity {
  id: number
  type: "payment" | "swap" | "lending" | "staking" | "airdrop"
  description: string
  amount: string
  time: string
  status: "completed" | "active" | "pending"
  network?: string
  txHash?: string
}

export interface DeFiOpportunity {
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

export interface DashboardData {
  balances: Balance[]
  recentActivity: Activity[]
  promotions: DeFiOpportunity[]
}

export type TabType = "overview" | "portfolio" | "defi" | "payment"