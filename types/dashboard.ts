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
  /** The four things money can do in EngiPay. */
  type: "payment" | "convert" | "deposit" | "withdrawal"
  description: string
  amount: string
  time: string
  status: "completed" | "active" | "pending"
  network?: string
  txHash?: string
}

export interface DashboardData {
  balances: Balance[]
  recentActivity: Activity[]
}

export type TabType = "overview" | "payments"
