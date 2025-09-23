"use client"

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface WalletContextType {
  isConnected: boolean
  walletAddress: string | null
  walletName: string | null
  isConnecting: boolean
  connectWallet: (walletName: string) => Promise<void>
  disconnectWallet: () => void
  openWalletModal: () => void
  closeWalletModal: () => void
  showWalletModal: boolean
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

interface WalletProviderProps {
  children: ReactNode
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [isConnected, setIsConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletName, setWalletName] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [showWalletModal, setShowWalletModal] = useState(false)

  // Check for existing connection on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem('engipay-wallet')
    if (savedWallet) {
      const { address, name } = JSON.parse(savedWallet)
      setWalletAddress(address)
      setWalletName(name)
      setIsConnected(true)
    }
  }, [])

  const connectWallet = async (walletName: string) => {
    setIsConnecting(true)

    // Simulate wallet connection
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const mockAddress = `0x${Math.random().toString(16).substr(2, 40)}`
        setWalletAddress(mockAddress)
        setWalletName(walletName)
        setIsConnected(true)
        setIsConnecting(false)
        setShowWalletModal(false)

        // Persist connection
        localStorage.setItem('engipay-wallet', JSON.stringify({
          address: mockAddress,
          name: walletName
        }))

        resolve()
      }, 1500)
    })
  }

  const disconnectWallet = () => {
    setIsConnected(false)
    setWalletAddress(null)
    setWalletName(null)
    localStorage.removeItem('engipay-wallet')
  }

  const openWalletModal = () => setShowWalletModal(true)
  const closeWalletModal = () => setShowWalletModal(false)

  const value: WalletContextType = {
    isConnected,
    walletAddress,
    walletName,
    isConnecting,
    connectWallet,
    disconnectWallet,
    openWalletModal,
    closeWalletModal,
    showWalletModal
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}