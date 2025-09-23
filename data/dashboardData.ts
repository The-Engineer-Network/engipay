import { Balance, Activity, DeFiOpportunity } from "@/types/dashboard"

export const mockBalances: Balance[] = [
  {
    symbol: "STRK",
    name: "StarkNet",
    balance: "1,250.50",
    value: "$2,501.00",
    change: "+2.5%",
    icon: "🌟",
    trend: "up",
    volume: "24h: $1.2M"
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    balance: "0.85",
    value: "$2,125.00",
    change: "-1.2%",
    icon: "🔷",
    trend: "down",
    volume: "24h: $8.5M"
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    balance: "0.023",
    value: "$1,380.00",
    change: "+0.8%",
    icon: "🟠",
    trend: "up",
    volume: "24h: $15.2M"
  },
  {
    symbol: "USDT",
    name: "Tether",
    balance: "250.00",
    value: "$250.00",
    change: "+0.1%",
    icon: "💵",
    trend: "up",
    volume: "24h: $3.8M"
  },
]

export const mockRecentActivity: Activity[] = [
  {
    id: 1,
    type: "payment",
    description: "Payment to Coffee Shop",
    amount: "-$12.50",
    time: "2 hours ago",
    status: "completed",
    network: "StarkNet",
    txHash: "0x1234...5678"
  },
  {
    id: 2,
    type: "swap",
    description: "Swapped ETH → STRK",
    amount: "+250 STRK",
    time: "5 hours ago",
    status: "completed",
    network: "Uniswap",
    txHash: "0xabcd...efgh"
  },
  {
    id: 3,
    type: "staking",
    description: "Staked STRK for rewards",
    amount: "-500 STRK",
    time: "1 day ago",
    status: "active",
    network: "StarkNet",
    txHash: "0x9876...1234"
  },
  {
    id: 4,
    type: "airdrop",
    description: "Received AAVE airdrop",
    amount: "+100 AAVE",
    time: "2 days ago",
    status: "completed",
    network: "Ethereum",
    txHash: "0xa1b2...c3d4"
  },
  {
    id: 5,
    type: "lending",
    description: "Lent USDC on Aave",
    amount: "-200 USDC",
    time: "3 days ago",
    status: "active",
    network: "Ethereum",
    txHash: "0xb5c6...d7e8"
  },
  {
    id: 6,
    type: "payment",
    description: "Received from Alice",
    amount: "+$50.00",
    time: "4 days ago",
    status: "completed",
    network: "StarkNet",
    txHash: "0xc9d0...eaf1"
  },
]

export const mockDeFiOpportunities: DeFiOpportunity[] = [
  {
    id: 1,
    title: "High Yield Staking",
    description: "Earn up to 12% APY on STRK staking with daily rewards",
    apy: "12%",
    protocol: "StarkNet",
    action: "Stake Now",
    risk: "low",
    tvl: "$45.2M",
    rewards: "STRK + NFTs",
    duration: "30 days"
  },
  {
    id: 2,
    title: "Liquidity Mining",
    description: "Provide liquidity to ETH-STRK pool and earn trading fees",
    apy: "25%",
    protocol: "Uniswap V3",
    action: "Add Liquidity",
    risk: "medium",
    tvl: "$12.8M",
    rewards: "UNI + Fees",
    duration: "Flexible"
  },
  {
    id: 3,
    title: "Lending Opportunity",
    description: "Lend USDC and earn interest from borrowers",
    apy: "8%",
    protocol: "Aave",
    action: "Lend Now",
    risk: "low",
    tvl: "$89.5M",
    rewards: "AAVE + Interest",
    duration: "Flexible"
  },
  {
    id: 4,
    title: "Yield Farming",
    description: "Farm high yields with COMP governance tokens",
    apy: "18%",
    protocol: "Compound",
    action: "Farm Now",
    risk: "medium",
    tvl: "$156.3M",
    rewards: "COMP + Yields",
    duration: "14 days"
  },
  {
    id: 5,
    title: "Stablecoin Pool",
    description: "Provide liquidity to 3Pool and earn stable returns",
    apy: "6%",
    protocol: "Curve",
    action: "Deposit",
    risk: "low",
    tvl: "$234.1M",
    rewards: "CRV + Fees",
    duration: "Flexible"
  },
]
