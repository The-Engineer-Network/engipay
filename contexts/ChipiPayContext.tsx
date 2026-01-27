'use client'

import React, { createContext, useContext, ReactNode } from 'react'

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
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

  const getSKUs = async (): Promise<SKU[]> => {
    try {
      const response = await fetch(`${backendUrl}/api/chipipay/skus`, {
        headers: {
          'Content-Type': 'application/json',
        },
      })
      
      if (!response.ok) {
        throw new Error('Failed to fetch SKUs')
      }
      
      const data = await response.json()
      return data.skus || []
    } catch (error) {
      console.error('Error fetching SKUs:', error)
      throw error
    }
  }

  const buySKU = async (skuId: string, options: any = {}) => {
    try {
      const authToken = localStorage.getItem('auth-token')
      
      const response = await fetch(`${backendUrl}/api/chipipay/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
        body: JSON.stringify({
          sku_id: skuId,
          ...options,
        }),
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || 'Purchase failed')
      }
      
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error purchasing SKU:', error)
      throw error
    }
  }

  return (
    <ChipiPayContext.Provider value={{ getSKUs, buySKU }}>
      {children}
    </ChipiPayContext.Provider>
  )
}