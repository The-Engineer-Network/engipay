'use client'

import { useState } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { Send, ArrowLeftRight, QrCode, Building2, Copy, Check, X } from 'lucide-react'
import { paymentService, escrowService } from '@/lib/starknet'
import { Account } from 'starknet'

interface PaymentModalsProps {
  activeModal: 'send' | 'request' | 'qr' | 'merchant' | null
  onClose: () => void
}

export function PaymentModals({ activeModal, onClose }: PaymentModalsProps) {
  const [modalRecipient, setModalRecipient] = useState('')
  const [modalAmount, setModalAmount] = useState('')
  const [modalAsset, setModalAsset] = useState('ETH')
  const [modalMemo, setModalMemo] = useState('')
  const [modalExpiry, setModalExpiry] = useState('24')
  const [isProcessing, setIsProcessing] = useState(false)
  const [paymentLink, setPaymentLink] = useState('')
  const [copied, setCopied] = useState(false)
  const { isConnected, walletAddress, starknetAccount } = useWallet()

  const handleSendPayment = async () => {
    if (!isConnected || !walletAddress) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect your wallet first',
        variant: 'destructive',
      })
      return
    }

    if (!modalRecipient || !modalAmount) {
      toast({
        title: 'Missing Information',
        description: 'Please enter recipient address and amount',
        variant: 'destructive',
      })
      return
    }

    if (!starknetAccount) {
      toast({
        title: 'Starknet Account Required',
        description: 'Please connect a Starknet wallet (Argent or Braavos)',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)
    try {
      // Convert amount to wei
      const amountInWei = paymentService.parseUnits(modalAmount, 18)

      // Execute blockchain transaction
      const result = await paymentService.sendPayment(
        modalRecipient,
        amountInWei,
        modalAsset,
        starknetAccount as Account
      )

      // Notify backend of successful transaction
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/payments/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
        body: JSON.stringify({
          tx_hash: result.transaction_hash,
          transaction_id: `tx_${Date.now()}`,
          type: 'send'
        }),
      })

      toast({
        title: 'Payment Sent Successfully! 🎉',
        description: `Transaction confirmed on blockchain`,
      })

      // Open explorer in new tab
      window.open(result.explorer_url, '_blank')

      resetForm()
      onClose()
    } catch (error: any) {
      console.error('Payment error:', error)
      toast({
        title: 'Payment Failed',
        description: error.message || 'Transaction was rejected or failed',
        variant: 'destructive',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRequestPayment = async () => {
    if (!isConnected || !walletAddress) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect your wallet first',
        variant: 'destructive',
      })
      return
    }

    if (!modalAmount) {
      toast({
        title: 'Missing Information',
        description: 'Please enter payment amount',
        variant: 'destructive',
      })
      return
    }

    if (!starknetAccount) {
      toast({
        title: 'Starknet Account Required',
        description: 'Please connect a Starknet wallet (Argent or Braavos)',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)
    try {
      // Convert amount to wei
      const amountInWei = paymentService.parseUnits(modalAmount, 18)
      const tokenAddress = paymentService.getTokenAddress(modalAsset)

      // Create payment request on-chain
      const txHash = await escrowService.createPaymentRequest(
        walletAddress, // recipient (who will receive the payment)
        amountInWei,
        tokenAddress,
        parseInt(modalExpiry),
        modalMemo || '',
        starknetAccount as Account
      )

      const requestId = `req_${Date.now()}_${txHash.slice(2, 10)}`
      const paymentLink = `${window.location.origin}/pay/${requestId}`

      setPaymentLink(paymentLink)

      toast({
        title: 'Payment Request Created! 📨',
        description: `Request created on blockchain`,
      })

      // Open explorer
      window.open(`https://starkscan.co/tx/${txHash}`, '_blank')
    } catch (error: any) {
      console.error('Request error:', error)
      toast({
        title: 'Request Failed',
        description: error.message || 'Failed to create payment request',
        variant: 'destructive',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleMerchantPayment = async () => {
    if (!isConnected || !walletAddress) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect your wallet first',
        variant: 'destructive',
      })
      return
    }

    if (!modalRecipient || !modalAmount) {
      toast({
        title: 'Missing Information',
        description: 'Please enter merchant ID and amount',
        variant: 'destructive',
      })
      return
    }

    if (!starknetAccount) {
      toast({
        title: 'Starknet Account Required',
        description: 'Please connect a Starknet wallet (Argent or Braavos)',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)
    try {
      // Validate merchant address
      const merchantAddress = modalRecipient.startsWith('0x') ? modalRecipient : `0x${modalRecipient}`

      // Convert amount to wei
      const amountInWei = paymentService.parseUnits(modalAmount, 18)

      // Execute blockchain transaction
      const result = await paymentService.sendPayment(
        merchantAddress,
        amountInWei,
        modalAsset,
        starknetAccount as Account
      )

      // Notify backend
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/payments/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
        body: JSON.stringify({
          tx_hash: result.transaction_hash,
          transaction_id: `tx_merchant_${Date.now()}`,
          type: 'merchant'
        }),
      })

      toast({
        title: 'Merchant Payment Sent! 🏪',
        description: `Payment confirmed on blockchain`,
      })

      // Open explorer
      window.open(result.explorer_url, '_blank')

      resetForm()
      onClose()
    } catch (error: any) {
      console.error('Merchant payment error:', error)
      toast({
        title: 'Payment Failed',
        description: error.message || 'Failed to process merchant payment',
        variant: 'destructive',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast({
      title: 'Copied!',
      description: 'Payment link copied to clipboard',
    })
    setTimeout(() => setCopied(false), 2000)
  }

  const resetForm = () => {
    setModalRecipient('')
    setModalAmount('')
    setModalMemo('')
    setPaymentLink('')
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  if (!activeModal) return null

  return (
    <>
      {/* Send Payment Modal */}
      {activeModal === 'send' && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <Card className="glassmorphism max-w-md w-full border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5 text-primary" />
                Send Payment
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Recipient Address</label>
                <Input
                  placeholder="0x..."
                  value={modalRecipient}
                  onChange={(e) => setModalRecipient(e.target.value)}
                  className="glassmorphism"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Amount</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={modalAmount}
                    onChange={(e) => setModalAmount(e.target.value)}
                    className="glassmorphism"
                    step="0.000001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Asset</label>
                  <Select value={modalAsset} onValueChange={setModalAsset}>
                    <SelectTrigger className="glassmorphism">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ETH">ETH</SelectItem>
                      <SelectItem value="STRK">STRK</SelectItem>
                      <SelectItem value="ENGI">ENGI</SelectItem>
                      <SelectItem value="USDC">USDC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Memo (optional)</label>
                <Textarea
                  placeholder="Payment description..."
                  value={modalMemo}
                  onChange={(e) => setModalMemo(e.target.value)}
                  className="glassmorphism"
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSendPayment}
                  disabled={isProcessing || !modalRecipient || !modalAmount}
                  className="glow-button bg-primary hover:bg-primary/90 flex-1"
                >
                  {isProcessing ? 'Sending...' : 'Send Payment'}
                </Button>
                <Button
                  onClick={handleClose}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Request Payment Modal */}
      {activeModal === 'request' && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <Card className="glassmorphism max-w-md w-full border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-primary" />
                Request Payment
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Amount</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={modalAmount}
                    onChange={(e) => setModalAmount(e.target.value)}
                    className="glassmorphism"
                    step="0.000001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Asset</label>
                  <Select value={modalAsset} onValueChange={setModalAsset}>
                    <SelectTrigger className="glassmorphism">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ETH">ETH</SelectItem>
                      <SelectItem value="STRK">STRK</SelectItem>
                      <SelectItem value="ENGI">ENGI</SelectItem>
                      <SelectItem value="USDC">USDC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Expiry</label>
                <Select value={modalExpiry} onValueChange={setModalExpiry}>
                  <SelectTrigger className="glassmorphism">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 hour</SelectItem>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="168">1 week</SelectItem>
                    <SelectItem value="720">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Memo (optional)</label>
                <Textarea
                  placeholder="Payment description..."
                  value={modalMemo}
                  onChange={(e) => setModalMemo(e.target.value)}
                  className="glassmorphism"
                  rows={2}
                />
              </div>

              {paymentLink && (
                <div className="p-4 bg-primary/10 rounded-lg border border-primary/30">
                  <label className="block text-sm font-medium mb-2">Payment Link</label>
                  <div className="flex gap-2">
                    <Input
                      value={paymentLink}
                      readOnly
                      className="glassmorphism text-sm"
                    />
                    <Button
                      onClick={() => copyToClipboard(paymentLink)}
                      variant="outline"
                      size="icon"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleRequestPayment}
                  disabled={isProcessing || !modalAmount || !!paymentLink}
                  className="glow-button bg-primary hover:bg-primary/90 flex-1"
                >
                  {isProcessing ? 'Creating...' : paymentLink ? 'Request Created' : 'Create Request'}
                </Button>
                <Button
                  onClick={handleClose}
                  variant="outline"
                  className="flex-1"
                >
                  {paymentLink ? 'Done' : 'Cancel'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* QR Code Modal */}
      {activeModal === 'qr' && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <Card className="glassmorphism max-w-md w-full border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-primary" />
                Scan QR Code
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-white p-8 rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <QrCode className="w-32 h-32 mx-auto text-black mb-4" />
                  <p className="text-black text-sm font-medium">QR Scanner Coming Soon</p>
                  <p className="text-gray-600 text-xs mt-2">
                    Camera access required
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Scan a QR code to quickly send payments or connect with merchants
              </p>
              <Button
                onClick={handleClose}
                variant="outline"
                className="w-full"
              >
                Close
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Merchant Payment Modal */}
      {activeModal === 'merchant' && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <Card className="glassmorphism max-w-md w-full border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                Merchant Payments
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Merchant ID or Address</label>
                <Input
                  placeholder="merchant@engipay or 0x..."
                  value={modalRecipient}
                  onChange={(e) => setModalRecipient(e.target.value)}
                  className="glassmorphism"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Amount</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={modalAmount}
                    onChange={(e) => setModalAmount(e.target.value)}
                    className="glassmorphism"
                    step="0.000001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Asset</label>
                  <Select value={modalAsset} onValueChange={setModalAsset}>
                    <SelectTrigger className="glassmorphism">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ETH">ETH</SelectItem>
                      <SelectItem value="STRK">STRK</SelectItem>
                      <SelectItem value="ENGI">ENGI</SelectItem>
                      <SelectItem value="USDC">USDC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Invoice/Order ID (optional)</label>
                <Input
                  placeholder="INV-12345"
                  value={modalMemo}
                  onChange={(e) => setModalMemo(e.target.value)}
                  className="glassmorphism"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleMerchantPayment}
                  disabled={isProcessing || !modalRecipient || !modalAmount}
                  className="glow-button bg-primary hover:bg-primary/90 flex-1"
                >
                  {isProcessing ? 'Processing...' : 'Pay Merchant'}
                </Button>
                <Button
                  onClick={handleClose}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
