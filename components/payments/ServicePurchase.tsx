'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { useChipiPay } from '@/contexts/ChipiPayContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader } from '@/components/ui/loader'
import { useToast } from '@/hooks/use-toast'

interface SKU {
  id: string
  name: string
  description: string
  price: number
}

export function ServicePurchase() {
  const [skus, setSkus] = useState<SKU[]>([])
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<string | null>(null)
  const { walletAddress, isConnected } = useWallet()
  const { getSKUs, buySKU } = useChipiPay()
  const { toast } = useToast()

  useEffect(() => {
    fetchSKUs()
  }, [])

  const fetchSKUs = async () => {
    try {
      const data = await getSKUs()
      setSkus(data || [])
    } catch (error) {
      console.error('Error fetching SKUs:', error)
      toast({
        title: 'Error',
        description: 'Failed to load services',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handlePurchase = async (skuId: string) => {
    if (!isConnected || !walletAddress) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet to make a purchase',
        variant: 'destructive',
      })
      return
    }

    setBuying(skuId)
    try {
      await buySKU(skuId, {
        quantity: 1,
        recipient_address: walletAddress,
      })

      toast({
        title: 'Purchase Successful',
        description: 'Your service purchase is being processed.',
      })
    } catch (error) {
      console.error('Purchase error:', error)
      toast({
        title: 'Purchase Failed',
        description: 'Please try again or contact support.',
        variant: 'destructive',
      })
    } finally {
      setBuying(null)
    }
  }

  if (loading) return <Loader />

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Purchase Services</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skus.map((sku) => (
          <Card key={sku.id}>
            <CardHeader>
              <CardTitle>{sku.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">{sku.description}</p>
              <p className="text-lg font-semibold mb-4">${sku.price}</p>
              <Button
                onClick={() => handlePurchase(sku.id)}
                disabled={buying === sku.id || !isConnected}
                className="w-full"
              >
                {buying === sku.id ? <Loader /> : 'Purchase'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}