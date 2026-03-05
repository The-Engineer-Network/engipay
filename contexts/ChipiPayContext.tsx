'use client'

import React, { createContext, useContext, ReactNode } from 'react'
import { ChipiProvider } from '@chipi-stack/nextjs'

interface SKU {
  id: string
  name: string
  description: string
  price: number
  currency: string
  available: boolean
}

interface ChipiPayContextType {
  getSKUs: () => Promise<SKU[]>
  buySKU: (skuId: string, options?: any) => Promise<any>
}

const ChipiPayContext = createContext<ChipiPayContextType | undefined>(undefined)

export function useChipiPay() {
  const context = useContext(ChipiPayContext)
  if (!context) {
    throw new Error('useChipiPay must be used within ChipiPayProvider')
  }
  return context
}

interface ChipiPayProviderProps {
  children: ReactNode
}

export function ChipiPayProviderWrapper({ children }: ChipiPayProviderProps) {
  const apiKey = process.env.NEXT_PUBLIC_CHIPIPAY_API_KEY || ''
  
  const getSKUs = async (): Promise<SKU[]> => {
    try {
      // Demo SKUs - replace with your actual product SKUs
      return [
        {
          id: 'sku_premium',
          name: 'Premium Membership',
          description: 'Access to premium features and priority support',
          price: 9.99,
          currency: 'USD',
          available: true,
        },
        {
          id: 'sku_pro',
          name: 'Pro Service Package',
          description: 'Professional tier with advanced analytics',
          price: 19.99,
          currency: 'USD',
          available: true,
        },
        {
          id: 'sku_enterprise',
          name: 'Enterprise Solution',
          description: 'Full enterprise features with dedicated support',
          price: 49.99,
          currency: 'USD',
          available: true,
        },
      ]
    } catch (error) {
      console.error('Error fetching SKUs:', error)
      return []
    }
  }

  const buySKU = async (skuId: string, options: any = {}) => {
    try {
      // This will be handled by ChipiPay SDK hooks in components
      console.log('Purchase initiated:', { skuId, options })
      
      return {
        success: true,
        transaction_id: `tx_${Date.now()}`,
        status: 'pending',
        message: 'Use useChipiWallet and useChipiSession hooks for actual transactions',
      }
    } catch (error) {
      console.error('Error purchasing SKU:', error)
      throw error
    }
  }

  return (
    <ChipiProvider apiKey={apiKey}>
      <ChipiPayContext.Provider value={{ getSKUs, buySKU }}>
        {children}
      </ChipiPayContext.Provider>
    </ChipiProvider>
  )
}