'use client'

import { useState } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Send, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export function SendPayment() {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [asset, setAsset] = useState('STRK')
  const [memo, setMemo] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [txHash, setTxHash] = useState('')
  const { walletAddress, isConnected, starknetAccount } = useWallet()

  const handleSend = async () => {
    if (!isConnected || !walletAddress || !starknetAccount) {
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
    setTxHash('')

    try {
      // Step 1: Prepare transaction via backend
      const prepareResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/payments/v2/send`, {
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
        }),
      })

      const prepareData = await prepareResponse.json()

      if (!prepareResponse.ok) {
        throw new Error(prepareData.error?.message || 'Failed to prepare payment')
      }

      toast({
        title: 'Please sign transaction',
        description: 'Confirm the transaction in your wallet',
      })

      // Step 2: Sign transaction with wallet
      const { transaction_hash } = await starknetAccount.execute({
        contractAddress: prepareData.transaction_data.contract_address,
        entrypoint: prepareData.transaction_data.entry_point,
        calldata: [recipient, amount],
      })

      setTxHash(transaction_hash)

      toast({
        title: 'Transaction submitted',
        description: 'Waiting for confirmation...',
      })

      // Step 3: Submit transaction hash to backend
      const executeResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/payments/v2/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
        body: JSON.stringify({
          transaction_id: prepareData.transaction_id,
          tx_hash: transaction_hash,
          type: 'send',
        }),
      })

      const executeData = await executeResponse.json()

      if (!executeResponse.ok) {
        throw new Error(executeData.error?.message || 'Failed to execute payment')
      }

      toast({
        title: 'Payment Sent! 🎉',
        description: (
          <div className="flex flex-col gap-2">
            <p>Transaction submitted successfully</p>
            <a
              href={executeData.explorer_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              View on StarkScan <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ),
      })

      // Reset form
      setRecipient('')
      setAmount('')
      setMemo('')
    } catch (error: any) {
      console.error('Payment error:', error)
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
          {isSending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Sending...
            </>
          ) : (
            'Send Payment'
          )}
        </Button>

        {txHash && (
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm font-medium text-green-400 mb-1">Transaction Submitted</p>
            <a
              href={`https://starkscan.co/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-green-300 hover:underline flex items-center gap-1"
            >
              {txHash.substring(0, 10)}...{txHash.substring(txHash.length - 8)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
