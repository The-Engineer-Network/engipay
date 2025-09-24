"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Wallet, ExternalLink } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"

export function DashboardHeader() {
  const router = useRouter()
  const { walletAddress, walletName, disconnectWallet } = useWallet()

  const handleWalletDisconnect = () => {
    disconnectWallet()
    router.push('/')
  }

  return (
    <header style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/" className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: '#00d084' }}
              >
                <span style={{ color: '#000000' }} className="font-bold text-sm">E</span>
              </div>
              <span className="text-xl font-bold" style={{ color: '#ffffff' }}>EngiPay</span>
            </Link>
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#ffffff' }}> Dashboard</h1>
              <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '14px' }}>
                Welcome back! Here's your financial overview
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              style={{
                borderColor: 'rgba(255, 255, 255, 0.2)',
                color: '#00d084'
              }}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Explorer
            </Button>
            <Button
              size="sm"
              onClick={handleWalletDisconnect}
              style={{
                backgroundColor: '#00d084',
                color: '#000000',
                border: 'none'
              }}
              className="hover:opacity-90"
            >
              <Wallet className="w-4 h-4 mr-2" />
              {walletAddress ? `${walletName} (${walletAddress.slice(0, 6)}...)` : 'Connect'}
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}