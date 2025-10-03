// Extracted TypeScript ABIs from the codebase

import * as React from 'react'

// From types/dashboard.ts
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

// From contexts/WalletContext.tsx
export interface WalletContextType {
  isConnected: boolean;
  walletAddress: string | null;
  walletName: string | null;
  isConnecting: boolean;
  connectWallet: (walletName: string) => Promise<void>;
  disconnectWallet: () => void;
  openWalletModal: () => void;
  closeWalletModal: () => void;
  showWalletModal: boolean;
  checkWalletInstalled: (walletName: string) => boolean;
}

export interface WalletProviderProps {
  children: React.ReactNode;
}

// From hooks/use-toast.ts
interface ToastProps {
  variant?: 'default' | 'destructive'
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface ToastActionElement {
  // Placeholder for toast action element
}

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const actionTypes = {
  ADD_TOAST: 'ADD_TOAST',
  UPDATE_TOAST: 'UPDATE_TOAST',
  DISMISS_TOAST: 'DISMISS_TOAST',
  REMOVE_TOAST: 'REMOVE_TOAST',
} as const

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType['ADD_TOAST']
      toast: ToasterToast
    }
  | {
      type: ActionType['UPDATE_TOAST']
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType['DISMISS_TOAST']
      toastId?: ToasterToast['id']
    }
  | {
      type: ActionType['REMOVE_TOAST']
      toastId?: ToasterToast['id']
    }

interface State {
  toasts: ToasterToast[]
}

type Toast = Omit<ToasterToast, 'id'>

// Global window interface extension
declare global {
  interface Window {
    ethereum?: any;
  }
}