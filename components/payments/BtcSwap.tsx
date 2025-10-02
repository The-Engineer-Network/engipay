"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeftRight, Bitcoin, Coins, Zap, Loader2 } from 'lucide-react';
import { atomiq, SwapParams, SwapResult, SwapQuote } from '@/lib/atomiq';
import { xverseWallet } from '@/lib/xverse';
import { useWallet } from '@/contexts/WalletContext';
import { toast } from '@/hooks/use-toast';

export function BtcSwap() {
  const [swapParams, setSwapParams] = useState<SwapParams>({
    fromToken: 'BTC',
    toToken: 'ETH',
    amount: '',
    slippage: 0.5,
  });
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [swapStatus, setSwapStatus] = useState<string>('');
  const [isSwapping, setIsSwapping] = useState(false);
  const [isGettingQuote, setIsGettingQuote] = useState(false);
  const { walletName } = useWallet();

  const tokens = [
    { symbol: 'BTC', name: 'Bitcoin', icon: <Bitcoin className="w-4 h-4" /> },
    { symbol: 'ETH', name: 'Ethereum', icon: <Coins className="w-4 h-4" /> },
    { symbol: 'STRK', name: 'Starknet', icon: <Zap className="w-4 h-4" /> },
  ];

  const getQuote = async () => {
    if (!swapParams.amount || parseFloat(swapParams.amount) <= 0) return;

    setIsGettingQuote(true);
    try {
      const quote = await atomiq.getQuote(swapParams);
      setSwapQuote(quote);
    } catch (error) {
      console.error('Error getting quote:', error);
      toast({
        title: 'Quote Error',
        description: 'Failed to get swap quote. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGettingQuote(false);
    }
  };

  const handleSwap = async () => {
    if (!swapParams.amount || !swapQuote) return;

    setIsSwapping(true);
    setSwapStatus('Connecting Wallet...');

    try {
      // Ensure Xverse wallet is connected for BTC operations
      if (swapParams.fromToken === 'BTC' || swapParams.toToken === 'BTC') {
        const connected = await xverseWallet.isConnected();
        if (!connected) {
          setSwapStatus('Connecting Xverse Wallet...');
          await xverseWallet.connect();
        }
      }

      setSwapStatus('Confirming in Wallet...');

      const result: SwapResult = await atomiq.swap(swapParams);

      if (result.status === 'failed') {
        throw new Error(result.details.error || 'Swap failed');
      }

      setSwapStatus('Transaction Pending...');

      // Poll for confirmation
      const confirmed = await pollSwapConfirmation(result.txHash);

      if (confirmed) {
        setSwapStatus(`✅ Swap Successful! Tx: ${result.txHash.slice(0, 10)}...`);
        toast({
          title: 'Swap Successful',
          description: `Successfully swapped ${swapParams.amount} ${swapParams.fromToken} to ${swapQuote.toAmount} ${swapParams.toToken}`,
        });
        // Reset form
        setSwapParams({ ...swapParams, amount: '' });
        setSwapQuote(null);
      } else {
        setSwapStatus('❌ Swap Failed - Please try again');
        toast({
          title: 'Swap Failed',
          description: 'The swap transaction failed. Please try again.',
          variant: 'destructive',
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

  const pollSwapConfirmation = async (txHash: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        // Mock confirmation - in real implementation, poll blockchain
        resolve(Math.random() > 0.1); // 90% success rate
      }, 3000);
    });
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
            <div className="flex items-center gap-2">
              {isSwapping && <Loader2 className="w-4 h-4 animate-spin" />}
              <span className="text-sm">{swapStatus}</span>
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