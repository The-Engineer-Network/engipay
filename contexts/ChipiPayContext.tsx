'use client'

import React, { createContext, useContext, ReactNode } from 'react'
// NOTE: import from `/client`. The package root exports an *async server*
// ChipiProvider which cannot be rendered from a client component and which
// additionally requires CHIPI_SECRET_KEY. The client provider takes its key
// through the `config` prop, which is what we want here.
import { ChipiProvider } from '@chipi-stack/nextjs/client'

export interface SKU {
  id: string
  name: string
  description: string
  price: number
  currency: string
  available: boolean
}

interface ChipiPayContextType {
  /** False when no NEXT_PUBLIC_CHIPI_API_KEY is set. Consumers must check this
   *  before calling any @chipi-stack hook, because the provider is not mounted. */
  isConfigured: boolean
  getSKUs: () => Promise<SKU[]>
}

const ChipiPayContext = createContext<ChipiPayContextType | undefined>(undefined)

export function useChipiPay() {
  const context = useContext(ChipiPayContext)
  if (!context) {
    throw new Error('useChipiPay must be used within ChipiPayProviderWrapper')
  }
  return context
}

const CHIPI_API_KEY =
  process.env.NEXT_PUBLIC_CHIPI_API_KEY || process.env.NEXT_PUBLIC_CHIPIPAY_API_KEY || ''

async function getSKUs(): Promise<SKU[]> {
  const res = await fetch('/api/chipipay/skus', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load services (${res.status})`)
  const data = await res.json()
  return Array.isArray(data?.skus) ? data.skus : []
}

export function ChipiPayProviderWrapper({ children }: { children: ReactNode }) {
  const isConfigured = CHIPI_API_KEY.length > 0
  const value: ChipiPayContextType = { isConfigured, getSKUs }

  // Without a key the provider throws on render, which previously broke every
  // page in the app. Mount it only when configured and degrade gracefully
  // otherwise; ServicePurchase renders an explicit "unavailable" state.
  if (!isConfigured) {
    return <ChipiPayContext.Provider value={value}>{children}</ChipiPayContext.Provider>
  }

  return (
    <ChipiProvider config={{ apiPublicKey: CHIPI_API_KEY }}>
      <ChipiPayContext.Provider value={value}>{children}</ChipiPayContext.Provider>
    </ChipiProvider>
  )
}
