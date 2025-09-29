'use client'

import React, { createContext, useContext, ReactNode } from 'react'

interface ChipiPayContextType {
  apiKey: string
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
  const apiKey = process.env.NEXT_PUBLIC_CHIPI_API_KEY!

  return (
    <ChipiPayContext.Provider value={{ apiKey }}>
      {children}
    </ChipiPayContext.Provider>
  )
}