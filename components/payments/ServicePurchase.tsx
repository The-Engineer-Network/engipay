'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { useChipiPay } from '@/contexts/ChipiPayContext'
import { useChipiWallet } from '@chipi-stack/nextjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader } from '@/components/ui/loader'
import { useToast } from '@/hooks/use-toast'
import { Zap, ShoppingCart, CheckCircle2, Wallet } from 'lucide-react'

interface SKU {
  id: string
  name: string
  description: string
  price: number
  currency: string
  available: boolean
}

export function ServicePurchase() {
  const [skus, setSkus] = useState<SKU[]>([])
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<string | null>(null)
  const { walletAddress, isConnected } = useWallet()
  const { getSKUs } = useChipiPay()
  const { toast } = useToast()

  // ChipiPay wallet integration
  const {
    wallet: chipiWallet,
    hasWallet,
    formattedBalance,
    createWallet,
    isLoadingWallet,
  } = useChipiWallet({
    externalUserId: walletAddress || undefined,
    getBearerToken: async () => {
      // Get token from localStorage
      return localStorage.getItem('engipay-token') || ''
    },
  })

  useEffect(() => {
    fetchSKUs()
  }, [])

  const fetchSKUs = async () => {
    try {
      setLoading(true)
      const data = await getSKUs()
      setSkus(data || [])
    } catch (error) {
      console.error('Error fetching SKUs:', error)
      toast({
        title: 'Error Loading Services',
        description: 'Failed to load available services. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateChipiWallet = async () => {
    if (!isConnected || !walletAddress) {
      toast({
        title: 'Connect Wallet First',
        description: 'Please connect your wallet before creating a ChipiPay wallet',
        variant: 'destructive',
      })
      return
    }

    try {
      await createWallet({
        encryptKey: walletAddress.slice(0, 8), // Use part of wallet address as PIN
        chain: 'STARKNET',
      })
      
      toast({
        title: 'ChipiPay Wallet Created',
        description: 'Your gasless wallet is ready for transactions!',
      })
    } catch (error) {
      console.error('Error creating ChipiPay wallet:', error)
      toast({
        title: 'Wallet Creation Failed',
        description: 'Failed to create ChipiPay wallet. Please try again.',
        variant: 'destructive',
      })
    }
  }

  const handlePurchase = async (sku: SKU) => {
    if (!isConnected || !walletAddress) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect your wallet to make a purchase',
        variant: 'destructive',
      })
      return
    }

    setBuying(sku.id)
    try {
      const result = await buySKU(sku.id, {
        quantity: 1,
        recipient_address: walletAddress,
      })

      toast({
        title: 'Purchase Successful! 🎉',
        description: `Your ${sku.name} purchase is being processed. Transaction ID: ${result.transaction_id}`,
      })

      // Refresh SKUs after purchase
      setTimeout(() => fetchSKUs(), 2000)
    } catch (error: any) {
      console.error('Purchase error:', error)
      toast({
        title: 'Purchase Failed',
        description: error.message || 'Please try again or contact support.',
        variant: 'destructive',
      })
    } finally {
      setBuying(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader />
        <span className="ml-3 text-muted-foreground">Loading services...</span>
      </div>
    )
  }

  if (skus.length === 0) {
    return (
      <Card className="glassmorphism">
        <CardContent className="py-12 text-center">
          <Zap className="w-12 h-12 mx-auto mb-4 text-cyan-500 opacity-50" />
          <h3 className="text-xl font-semibold mb-2">No Services Available</h3>
          <p className="text-muted-foreground">Check back later for available services</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold flex items-center gap-2">
            <Zap className="w-8 h-8 text-cyan-500" />
            ChipiPay Services
          </h2>
          <p className="text-muted-foreground mt-1">Purchase digital services with crypto</p>
        </div>
        <Badge variant="outline" className="text-cyan-500 border-cyan-500">
          Powered by ChipiPay
        </Badge>
      </div>

      {/* ChipiPay Wallet Status */}
      {isConnected && (
        <Card className="glassmorphism border-cyan-500/30">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wallet className="w-5 h-5 text-cyan-500" />
                <div>
                  <p className="font-semibold">ChipiPay Gasless Wallet</p>
                  {hasWallet ? (
                    <p className="text-sm text-muted-foreground">
                      Balance: {formattedBalance} USDC
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Create a gasless wallet for instant transactions
                    </p>
                  )}
                </div>
              </div>
              {!hasWallet && (
                <Button
                  onClick={handleCreateChipiWallet}
                  disabled={isLoadingWallet}
                  variant="outline"
                  className="border-cyan-500 text-cyan-500 hover:bg-cyan-500/10"
                >
                  {isLoadingWallet ? (
                    <>
                      <Loader />
                      <span className="ml-2">Creating...</span>
                    </>
                  ) : (
                    'Create Wallet'
                  )}
                </Button>
              )}
              {hasWallet && (
                <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/50">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Active
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {skus.map((sku) => (
          <Card 
            key={sku.id} 
            className={`glassmorphism hover:scale-105 transition-all duration-300 ${
              !sku.available ? 'opacity-60' : ''
            }`}
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-xl mb-2">{sku.name}</CardTitle>
                  <CardDescription className="text-sm">{sku.description}</CardDescription>
                </div>
                {sku.available && (
                  <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/50">
                    Available
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-primary">
                  ${sku.price.toFixed(2)}
                </span>
                <span className="text-sm text-muted-foreground">{sku.currency}</span>
              </div>

              <Button
                onClick={() => handlePurchase(sku)}
                disabled={buying === sku.id || !isConnected || !sku.available}
                className="glow-button bg-cyan-500 hover:bg-cyan-600 text-white w-full"
              >
                {buying === sku.id ? (
                  <>
                    <Loader />
                    <span className="ml-2">Processing...</span>
                  </>
                ) : !isConnected ? (
                  'Connect Wallet'
                ) : !sku.available ? (
                  'Unavailable'
                ) : (
                  <>
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Purchase Now
                  </>
                )}
              </Button>

              {!isConnected && (
                <p className="text-xs text-center text-muted-foreground">
                  Connect your wallet to purchase
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glassmorphism border-cyan-500/30">
        <CardContent className="py-6">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="w-6 h-6 text-cyan-500 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold mb-2">Secure & Instant</h4>
              <p className="text-sm text-muted-foreground">
                All purchases are processed securely through ChipiPay's blockchain infrastructure. 
                Your services will be delivered instantly upon transaction confirmation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}