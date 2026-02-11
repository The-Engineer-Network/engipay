"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeftRight, Bitcoin, Coins, Zap, Loader2, ExternalLink } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { toast } from '@/hooks/use-toast';

interface SwapParams {
  fromToken: string;
  toToken: string;
  amount: string;
  slippage: number;
}

interface SwapQuote {
  quoteId: string;
  fromAmount: string;
  toAmount: string;
  exchangeRate: string;
  fee: string;
  estimatedTime: string;
  slippage: string;
  expiresAt: string;
}

export function BtcSwap() {
  const [swapParams, setSwapParams] = useState<SwapParams>({
    fromToken: 'BTC',
    toToken: 'STRK',
    amount: '',
    slippage: 0.5,
  });
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [swapStatus, setSwapStatus] = useState<string>('');
  const [swapTxHash, setSwapTxHash] = useState<string>('');
  const [swapId, setSwapId] = useState<string>('');
  const [isSwapping, setIsSwapping] = useState(false);
  const [isGettingQuote, setIsGettingQuote] = useState(false);
  const { walletName, account, isConnected } = useWallet();

  const tokens = [
    { symbol: 'BTC', name: 'Bitcoin', icon: <Bitcoin className="w-4 h-4" /> },
    { symbol: 'STRK', name: 'Starknet', icon: <Zap className="w-4 h-4" /> },
  ];

  const getQuote = async () => {
    if (!swapParams.amount || parseFloat(swapParams.amount) <= 0) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid amount',
        variant: 'destructive',
      });
      return;
    }

    if (!isConnected) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect your wallet first',
        variant: 'destructive',
      });
      return;
    }

    setIsGettingQuote(true);
    try {
      const token = localStorage.getItem('engipay-token');
      if (!token) {
        throw new Error('No authentication token');
      }

      const response = await fetch('/api/swap/atomiq/quote', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fromToken: swapParams.fromToken,
          toToken: swapParams.toToken,
          amount: parseFloat(swapParams.amount),
          slippage: swapParams.slippage,
          bitcoinAddress: swapParams.fromToken === 'STRK' ? 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' : undefined
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to get quote');
      }

      const data = await response.json();
      setSwapQuote(data.quote);
      
      toast({
        title: 'Quote Retrieved',
        description: `Rate: 1 ${swapParams.fromToken} ≈ ${data.quote.exchangeRate} ${swapParams.toToken}`,
      });
    } catch (error: any) {
      console.error('Error getting quote:', error);
      toast({
        title: 'Quote Error',
        description: error.message || 'Failed to get swap quote. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGettingQuote(false);
    }
  };

  const handleSwap = async () => {
    if (!swapParams.amount || !swapQuote) return;

    setIsSwapping(true);
    setSwapStatus('Initiating swap...');

    try {
      const token = localStorage.getItem('engipay-token');
      if (!token) {
        throw new Error('No authentication token');
      }

      // Step 1: Initiate the swap
      setSwapStatus('Creating swap transaction...');
      const initiateResponse = await fetch('/api/swap/atomiq/initiate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteId: swapQuote.quoteId,
          fromToken: swapParams.fromToken,
          toToken: swapParams.toToken,
          fromAmount: swapParams.amount,
          toAmount: swapQuote.toAmount,
          slippage: swapParams.slippage
        }),
      });

      if (!initiateResponse.ok) {
        const error = await initiateResponse.json();
        throw new Error(error.error?.message || 'Failed to initiate swap');
      }

      const { swap, transaction_id } = await initiateResponse.json();
      setSwapId(transaction_id);

      // Step 2: Execute the swap with wallet
      setSwapStatus('Waiting for wallet confirmation...');

      let txHash: string;
      const direction = swapParams.fromToken === 'BTC' ? 'btc_to_strk' : 'strk_to_btc';

      if (swapParams.fromToken === 'BTC') {
        // BTC -> STRK: Use Xverse wallet
        const { xverseWallet } = await import('@/lib/xverse');
        const connected = await xverseWallet.isConnected();
        if (!connected) {
          setSwapStatus('Connecting Xverse Wallet...');
          await xverseWallet.connect();
        }

        // Send BTC transaction
        const btcAmount = Math.floor(parseFloat(swapParams.amount) * 100000000); // Convert to satoshis
        const result = await xverseWallet.sendBitcoin({
          to: swap.bitcoin_address || 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          amount: btcAmount
        });

        if (!result.success || !result.txId) {
          throw new Error(result.error || 'Bitcoin transaction failed');
        }
        txHash = result.txId;
      } else {
        // STRK -> BTC: Use StarkNet wallet
        if (!account) {
          throw new Error('StarkNet wallet not connected');
        }

        // Execute STRK transaction
        // This would involve calling the Atomiq contract on StarkNet
        // For now, we'll simulate with a placeholder
        txHash = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
      }

      // Step 3: Submit transaction hash to backend
      setSwapStatus('Processing swap...');
      const executeResponse = await fetch(`/api/swap/atomiq/${transaction_id}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tx_hash: txHash,
          direction
        }),
      });

      if (!executeResponse.ok) {
        throw new Error('Failed to submit transaction');
      }

      const executeResult = await executeResponse.json();
      setSwapTxHash(txHash);

      // Step 4: Monitor swap status
      setSwapStatus('Swap executing... This may take 10-30 minutes');
      
      toast({
        title: 'Swap Initiated',
        description: `Your swap is being processed. Transaction: ${txHash.slice(0, 10)}...`,
      });

      // Poll for completion
      const confirmed = await pollSwapConfirmation(transaction_id);

      if (confirmed) {
        setSwapStatus(`✅ Swap Successful!`);
        toast({
          title: 'Swap Completed',
          description: `Successfully swapped ${swapParams.amount} ${swapParams.fromToken} to ${swapQuote.toAmount} ${swapParams.toToken}`,
        });
        // Reset form
        setSwapParams({ ...swapParams, amount: '' });
        setSwapQuote(null);
      } else {
        setSwapStatus('⏳ Swap in progress - Check history for updates');
        toast({
          title: 'Swap Processing',
          description: 'Your swap is being processed. Check swap history for updates.',
        });
      }
    } catch (error: any) {
      console.error('Swap error:', error);
      const errorMessage = handleSwapError(error);
      setSwapStatus(`❌ ${errorMessage}`);
      toast({
        title: 'Swap Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSwapping(false);
    }
  };

  const pollSwapConfirmation = async (swapId: string): Promise<boolean> => {
    const maxAttempts = 6; // 6 attempts * 30s = 3 minutes (then user can check history)
    const pollInterval = 30000; // 30 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const token = localStorage.getItem('engipay-token');
        if (!token) return false;

        const response = await fetch(`/api/swap/atomiq/status/${swapId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          const status = data.swap?.status?.toLowerCase();
          
          if (status === 'completed' || status === 'settled') {
            return true;
          } else if (status === 'failed' || status === 'expired') {
            return false;
          }
        }
        
        // If pending, wait and try again
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        console.error('Error polling swap status:', error);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    // Return false after timeout (user can check history later)
    return false;
  };

  const handleSwapError = (error: any): string => {
    if (error.message?.includes('balance')) {
      return 'Insufficient balance for swap';
    }
    if (error.message?.includes('slippage')) {
      return 'Price slippage too high, try lower amount';
    }
    if (error.message?.includes('network')) {
      return 'Network error, please try again';
    }
    if (error.message?.includes('wallet')) {
      return 'Wallet rejected the transaction';
    }
    return error.message || 'Swap failed, please try again';
  };

  const availableToTokens = tokens.filter(t => t.symbol !== swapParams.fromToken);

  return (
    <Card className="glassmorphism">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5" />
          Cross-Chain Swap
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">From Token</label>
            <Select
              value={swapParams.fromToken}
              onValueChange={(value) => {
                setSwapParams({ ...swapParams, fromToken: value, toToken: availableToTokens[0]?.symbol || 'ETH' });
                setSwapQuote(null);
              }}
            >
              <SelectTrigger className="glassmorphism">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tokens.map((token) => (
                  <SelectItem key={token.symbol} value={token.symbol}>
                    <div className="flex items-center gap-2">
                      {token.icon}
                      {token.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">To Token</label>
            <Select
              value={swapParams.toToken}
              onValueChange={(value) => {
                setSwapParams({ ...swapParams, toToken: value });
                setSwapQuote(null);
              }}
            >
              <SelectTrigger className="glassmorphism">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableToTokens.map((token) => (
                  <SelectItem key={token.symbol} value={token.symbol}>
                    <div className="flex items-center gap-2">
                      {token.icon}
                      {token.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Amount</label>
          <Input
            type="number"
            placeholder="0.00"
            value={swapParams.amount}
            onChange={(e) => {
              setSwapParams({ ...swapParams, amount: e.target.value });
              setSwapQuote(null);
            }}
            className="glassmorphism"
            step="0.00000001"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Slippage Tolerance (%)</label>
          <Select
            value={swapParams.slippage?.toString()}
            onValueChange={(value) => {
              setSwapParams({ ...swapParams, slippage: parseFloat(value) });
              setSwapQuote(null);
            }}
          >
            <SelectTrigger className="glassmorphism">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.1">0.1%</SelectItem>
              <SelectItem value="0.5">0.5%</SelectItem>
              <SelectItem value="1.0">1.0%</SelectItem>
              <SelectItem value="2.0">2.0%</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!swapQuote && swapParams.amount && (
          <Button
            onClick={getQuote}
            disabled={isGettingQuote}
            className="w-full"
            variant="outline"
          >
            {isGettingQuote ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Getting Quote...
              </>
            ) : (
              'Get Quote'
            )}
          </Button>
        )}

        {swapQuote && (
          <div className="bg-muted/20 p-4 rounded-lg space-y-2">
            <h4 className="font-semibold">Swap Quote</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">You send:</span>
                <div className="font-medium">{swapParams.amount} {swapParams.fromToken}</div>
              </div>
              <div>
                <span className="text-muted-foreground">You receive:</span>
                <div className="font-medium">{swapQuote.toAmount} {swapParams.toToken}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Exchange Rate:</span>
                <div className="font-medium">1 {swapParams.fromToken} ≈ {swapQuote.exchangeRate} {swapParams.toToken}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Fee:</span>
                <div className="font-medium">{swapQuote.fee} {swapParams.fromToken}</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Estimated time: {swapQuote.estimatedTime}
            </div>
          </div>
        )}

        {swapStatus && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isSwapping && <Loader2 className="w-4 h-4 animate-spin" />}
                <span className="text-sm">{swapStatus}</span>
              </div>
              {swapTxHash && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const explorerUrl = swapParams.fromToken === 'BTC'
                      ? `https://mempool.space/tx/${swapTxHash}`
                      : `https://starkscan.co/tx/${swapTxHash}`;
                    window.open(explorerUrl, '_blank');
                  }}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        )}

        <Button
          onClick={handleSwap}
          disabled={isSwapping || !swapQuote || !swapParams.amount}
          className="glow-button bg-primary hover:bg-primary/90 text-primary-foreground w-full"
        >
          {isSwapping ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Swapping...
            </>
          ) : (
            <>
              <ArrowLeftRight className="w-4 h-4 mr-2" />
              Swap Now
            </>
          )}
        </Button>

        {(swapParams.fromToken === 'BTC' || swapParams.toToken === 'BTC') && walletName !== 'Xverse' && (
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
            <p className="text-sm text-orange-300">
              ⚠️ BTC operations require Xverse wallet. Please connect Xverse wallet first.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}