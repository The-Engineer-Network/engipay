import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Service catalogue for ChipiPay purchases.
 *
 * Defined here rather than in the client bundle so it can be swapped for a
 * database or the ChipiPay merchant API without touching the UI. Returns an
 * empty catalogue when ChipiPay is not configured, so the UI never shows
 * products that cannot actually be bought.
 */
const CATALOGUE = [
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

export async function GET() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_CHIPI_API_KEY || process.env.NEXT_PUBLIC_CHIPIPAY_API_KEY
  )

  return NextResponse.json({ configured, skus: configured ? CATALOGUE : [] })
}
