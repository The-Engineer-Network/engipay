'use client'

import { useState } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Send } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { engiTokenService } from '@/lib/starknet'

export function SendPayment() {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [asset, setAsset] = useState('ETH')
  const [memo, setMemo] = useState('')
  const [isSending, setIsSending] = useState(false)
  const { walletAddress, isConnected, starknetAccount } = useWallet()

  const handleSend = async () => {
    if (!isConnected || !walletAddress) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet to send payments',
        variant: 'destructive',
      })
      return
    }

    if (!recipient || !amount) {
      toast({
        title: 'Missing Information',
        description: 'Please enter recipient address and amount',
        variant: 'destructive',
      })
      return
    }

    setIsSending(true)
    try {
      // Call backend API
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/payments/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
        body: JSON.stringify({
          recipient,
          asset,
          amount,
          memo,
          network: 'starknet',
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Payment failed')
      }

      toast({
        title: 'Payment Sent',
        description: `Transaction ID: ${data.transaction_id}`,
      })

      // Reset form
      setRecipient('')
      setAmount('')
      setMemo('')
    } catch (error: any) {
      toast({
        title: 'Payment Failed',
        description: error.message || 'Failed to send payment',
        variant: 'destructive',
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Card className="glassmorphism">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="w-5 h-5" />
          Send Payment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Recipient Address</label>
          <Input
            placeholder="0x..."
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="glassmorphism"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Amount</label>
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="glassmorphism"
              step="0.000001"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Asset</label>
            <Select value={asset} onValueChange={setAsset}>
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
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="glassmorphism"
            rows={2}
          />
        </div>

        <Button
          onClick={handleSend}
          disabled={isSending || !recipient || !amount || !isConnected}
          className="glow-button bg-primary hover:bg-primary/90 w-full"
        >
          {isSending ? 'Sending...' : 'Send Payment'}
        </Button>
      </CardContent>
    </Card>
  )
}
