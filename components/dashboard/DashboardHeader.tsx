"use client"

import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Wallet, ExternalLink, Bitcoin } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { getBitcoinBalance } from "@/lib/xverse"

export function DashboardHeader() {
  const router = useRouter()
  const { walletAddress, walletName, disconnectWallet } = useWallet()
  const [btcBalance, setBtcBalance] = useState(0)

  useEffect(() => {
    const loadBtcBalance = async () => {
      if (walletName === 'Xverse') {
        try {
          const balance = await getBitcoinBalance()
          setBtcBalance(balance.total / 100000000) // Convert satoshis to BTC
        } catch (error) {
          console.error('Error loading BTC balance:', error)
        }
      }
    }
    loadBtcBalance()
  }, [walletName])

  const handleWalletDisconnect = () => {
    disconnectWallet()
    router.push('/')
  }

  return (
    <header style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Logo and Title Section */}
          <div className="flex items-center space-x-3 sm:space-x-4 min-w-0">
            <Link href="/" className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center flex-shrink-0">
                <img src="/engipay.png" alt="EngiPay Logo"
                className="h-full w-full object-contain drop-shadow-lg filter brightness-0 invert"
                />
              </div>
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="-ml-2text-lg sm:text-xl font-bold text-white truncate">Dashboard</h1>
              <p className="text-gray-300 text-xs sm:text-sm hidden sm:block">
                Welcome back! Here's your financial overview
              </p>
              {walletName === 'Xverse' && (
                <div className="flex items-center gap-2 mt-2">
                  <Bitcoin className="w-4 h-4 text-orange-400" />
                  <span className="text-sm text-orange-400">
                    BTC: {btcBalance.toFixed(8)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons Section */}
          <div className="flex items-center space-x-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              style={{
                borderColor: 'rgba(255, 255, 255, 0.2)',
                color: '#00d084'
              }}
              className="hidden sm:flex"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              <span className="hidden md:inline">Explorer</span>
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
              <span className="hidden sm:inline">
                {walletAddress ? `${walletName} (${walletAddress.slice(0, 6)}...)` : 'Connect'}
              </span>
              <span className="sm:hidden">
                {walletAddress ? walletAddress.slice(0, 4) + '...' : 'Connect'}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}