'use client'

import React, { createContext, useContext, ReactNode } from 'react'

interface ChipiPayContextType {
  apiKey: string
  getSKUs: () => Promise<any[]>
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
  const apiKey = process.env.NEXT_PUBLIC_CHIPIPAY_API_KEY!

  const getSKUs = async () => {
    const response = await fetch('https://api.chipipay.com/v1/skus', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })
    if (!response.ok) {
      throw new Error('Failed to fetch SKUs')
    }
    return response.json()
  }

  const buySKU = async (skuId: string, options: any = {}) => {
    const response = await fetch('https://api.chipipay.com/v1/buy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sku_id: skuId,
        ...options,
      }),
    })
    if (!response.ok) {
      throw new Error('Purchase failed')
    }
    return response.json()
  }

  return (
    <ChipiPayContext.Provider value={{ apiKey, getSKUs, buySKU }}>
      {children}
    </ChipiPayContext.Provider>
  )
}