export interface Balance {
  symbol: string
  name: string
  balance: string
  /** Funds locked in a ledger hold, as a decimal string. Absent when the
   *  source of the balance does not report holds. */
  held?: string
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
