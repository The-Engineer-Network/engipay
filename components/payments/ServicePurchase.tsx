'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { useChipiPay, type SKU } from '@/contexts/ChipiPayContext'
import { useChipiWallet } from '@chipi-stack/nextjs/hooks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader } from '@/components/ui/loader'
import { useToast } from '@/hooks/use-toast'
import { Zap, ShoppingCart, CheckCircle2, Wallet } from 'lucide-react'

/**
 * Outer guard. `useChipiWallet` requires the ChipiProvider, which is only
 * mounted when NEXT_PUBLIC_CHIPI_API_KEY is set. Calling the hook without it
 * throws, so the hook lives in the inner component that is never rendered
 * unless ChipiPay is configured.
 */
export function ServicePurchase() {
  const { isConfigured } = useChipiPay()

  if (!isConfigured) {
    return (
      <Card className="glassmorphism">
        <CardContent className="py-12 text-center">
          <Zap className="mx-auto mb-4 h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h3 className="mb-2 text-lg font-semibold">Service purchases unavailable</h3>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            ChipiPay is not configured for this environment, so digital services cannot be
            purchased right now. Everything else in EngiPay works normally.
          </p>
        </CardContent>
      </Card>
    )
  }

  return <ServicePurchaseInner />
}

function ServicePurchaseInner() {
  const [skus, setSkus] = useState<SKU[]>([])
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<string | null>(null)
  const { walletAddress, isConnected } = useWallet()
  const { getSKUs } = useChipiPay()
  const { toast } = useToast()

  const { hasWallet, formattedBalance, createWallet, isLoadingWallet } = useChipiWallet({
    externalUserId: walletAddress || undefined,
    getBearerToken: async () =>
      (typeof window !== 'undefined' && localStorage.getItem('engipay-token')) || '',
  })

  const fetchSKUs = useCallback(async () => {
    try {
      setLoading(true)
      setSkus((await getSKUs()) ?? [])
    } catch (error) {
      console.error('Error fetching SKUs:', error)
      toast({
        title: 'Could not load services',
        description: 'Please refresh the page to try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [getSKUs, toast])

  useEffect(() => {
    void fetchSKUs()
  }, [fetchSKUs])

  const handleCreateChipiWallet = async () => {
    if (!isConnected || !walletAddress) {
      toast({
        title: 'Connect a wallet first',
        description: 'Connect your wallet before creating a ChipiPay wallet.',
        variant: 'destructive',
      })
      return
    }

    try {
      await createWallet({ encryptKey: walletAddress.slice(0, 8), chain: 'STARKNET' })
      toast({
        title: 'Gasless wallet created',
        description: 'Your ChipiPay wallet is ready for transactions.',
      })
    } catch (error) {
      console.error('Error creating ChipiPay wallet:', error)
      toast({
        title: 'Wallet creation failed',
        description: 'Could not create the ChipiPay wallet. Please try again.',
        variant: 'destructive',
      })
    }
  }

  const handlePurchase = async (sku: SKU) => {
    if (!isConnected || !walletAddress) {
      toast({
        title: 'Wallet not connected',
        description: 'Connect your wallet to make a purchase.',
        variant: 'destructive',
      })
      return
    }

    setBuying(sku.id)
    // Checkout runs through the ChipiPay merchant flow, which needs merchant
    // credentials configured server-side. Report that plainly rather than
    // returning a fabricated confirmation.
    toast({
      title: 'Purchase unavailable',
      description:
        'Checkout is not connected to a ChipiPay merchant account yet, so this purchase cannot be completed.',
      variant: 'destructive',
    })
    setBuying(null)
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
          <Zap className="mx-auto mb-4 h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h3 className="mb-2 text-lg font-semibold">No services available</h3>
          <p className="text-sm text-muted-foreground">Check back later for available services.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Zap className="h-6 w-6 text-primary" aria-hidden="true" />
            Services
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Purchase digital services with crypto
          </p>
        </div>
        <Badge variant="outline" className="border-primary/40 text-primary">
          Powered by ChipiPay
        </Badge>
      </div>

      {isConnected && (
        <Card className="glassmorphism">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Wallet className="h-5 w-5 text-primary" aria-hidden="true" />
                <div>
                  <p className="font-medium">ChipiPay gasless wallet</p>
                  <p className="text-sm text-muted-foreground">
                    {hasWallet
                      ? `Balance: ${formattedBalance} USDC`
                      : 'Create a gasless wallet for instant transactions'}
                  </p>
                </div>
              </div>
              {hasWallet ? (
                <Badge className="border-primary/50 bg-primary/15 text-primary">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
                  Active
                </Badge>
              ) : (
                <Button
                  onClick={handleCreateChipiWallet}
                  disabled={isLoadingWallet}
                  variant="outline"
                >
                  {isLoadingWallet ? (
                    <>
                      <Loader />
                      <span className="ml-2">Creating...</span>
                    </>
                  ) : (
                    'Create wallet'
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {skus.map((sku) => (
          <Card
            key={sku.id}
            className={`glassmorphism transition-colors hover:border-primary/40 ${
              sku.available ? '' : 'opacity-60'
            }`}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <CardTitle className="mb-1 text-lg">{sku.name}</CardTitle>
                  <CardDescription>{sku.description}</CardDescription>
                </div>
                {sku.available && (
                  <Badge className="border-primary/50 bg-primary/15 text-primary">Available</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-semibold tabular-nums">${sku.price.toFixed(2)}</span>
                <span className="text-sm text-muted-foreground">{sku.currency}</span>
              </div>

              <Button
                onClick={() => handlePurchase(sku)}
                disabled={buying === sku.id || !isConnected || !sku.available}
                className="w-full"
              >
                {buying === sku.id ? (
                  <>
                    <Loader />
                    <span className="ml-2">Processing...</span>
                  </>
                ) : !isConnected ? (
                  'Connect wallet'
                ) : !sku.available ? (
                  'Unavailable'
                ) : (
                  <>
                    <ShoppingCart className="mr-2 h-4 w-4" aria-hidden="true" />
                    Purchase
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
