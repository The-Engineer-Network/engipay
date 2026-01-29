"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Bitcoin, 
  Coins, 
  Zap, 
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus
} from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { toast } from '@/hooks/use-toast';

interface TokenBalance {
  symbol: string;
  name: string;
  balance: string;
  usdValue: string;
  change24h: number;
  network: string;
}

interface SwapLimits {
  btc_to_strk: {
    input: { min: string; max: string };
    output: { min: string; max: string };
  };
  strk_to_btc: {
    input: { min: string; max: string };
    output: { min: string; max: string };
  };
}

export function CrossChainBalance() {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [swapLimits, setSwapLimits] = useState<SwapLimits | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { isConnected, walletAddress } = useWallet();

  useEffect(() => {
    if (isConnected) {
      loadBalances();
      loadSwapLimits();
    }
  }, [isConnected, walletAddress]);

  const loadBalances = async () => {
    if (!isConnected) return;

    try {
      const token = localStorage.getItem('engipay-token');
      if (!token) {
        throw new Error('No authentication token');
      }

      const response = await fetch('/api/portfolio/balances', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        
        // Transform the data to include cross-chain information
        const crossChainBalances: TokenBalance[] = [
          {
            symbol: 'BTC',
            name: 'Bitcoin',
            balance: data.btc?.balance || '0',
            usdValue: data.btc?.usdValue || '0',
            change24h: data.btc?.change24h || 0,
            network: 'Bitcoin'
          },
          {
            symbol: 'ETH',
            name: 'Ethereum',
            balance: data.eth?.balance || '0',
            usdValue: data.eth?.usdValue || '0',
            change24h: data.eth?.change24h || 0,
            network: 'Ethereum'
          },
          {
            symbol: 'STRK',
            name: 'Starknet',
            balance: data.strk?.balance || '0',
            usdValue: data.strk?.usdValue || '0',
            change24h: data.strk?.change24h || 0,
            network: 'StarkNet'
          }
        ];

        setBalances(crossChainBalances);
      }
    } catch (error) {
      console.error('Error loading balances:', error);
      toast({
        title: 'Error',
        description: 'Failed to load balances',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const loadSwapLimits = async () => {
    try {
      const token = localStorage.getItem('engipay-token');
      if (!token) return;

      const response = await fetch('/api/swap/atomiq/limits', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setSwapLimits(data);
      }
    } catch (error) {
      console.error('Error loading swap limits:', error);
    }
  };

  const refreshBalances = async () => {
    setIsRefreshing(true);
    await loadBalances();
  };

  const getTokenIcon = (symbol: string) => {
    switch (symbol) {
      case 'BTC':
        return <Bitcoin className="w-6 h-6 text-orange-500" />;
      case 'ETH':
        return <Coins className="w-6 h-6 text-blue-500" />;
      case 'STRK':
        return <Zap className="w-6 h-6 text-purple-500" />;
      default:
        return <Coins className="w-6 h-6" />;
    }
  };

  const getChangeIcon = (change: number) => {
    if (change > 0) return <TrendingUp className="w-4 h-4 text-green-500" />;
    if (change < 0) return <TrendingDown className="w-4 h-4 text-red-500" />;
    return <Minus className="w-4 h-4 text-muted-foreground" />;
  };

  const getChangeColor = (change: number) => {
    if (change > 0) return 'text-green-500';
    if (change < 0) return 'text-red-500';
    return 'text-muted-foreground';
  };

  const formatBalance = (balance: string, decimals: number = 6) => {
    const num = parseFloat(balance);
    if (isNaN(num)) return '0';
    if (num === 0) return '0';
    if (num < 0.000001) return '< 0.000001';
    return num.toFixed(decimals).replace(/\.?0+$/, '');
  };

  const formatUSD = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  };

  const formatLimitAmount = (amount: string, symbol: string) => {
    const num = parseFloat(amount);
    if (isNaN(num) || num === 0) return '0';
    
    if (symbol === 'BTC') {
      // Convert satoshis to BTC
      return (num / 100000000).toFixed(8).replace(/\.?0+$/, '');
    } else {
      // STRK amounts
      return (num / Math.pow(10, 18)).toFixed(6).replace(/\.?0+$/, '');
    }
  };

  const getTotalUSDValue = () => {
    return balances.reduce((total, balance) => {
      return total + parseFloat(balance.usdValue || '0');
    }, 0);
  };

  if (!isConnected) {
    return (
      <Card className="glassmorphism">
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Connect your wallet to view cross-chain balances</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Total Portfolio Value */}
      <Card className="glassmorphism">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Cross-Chain Portfolio</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshBalances}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center mb-6">
            <p className="text-3xl font-bold">{formatUSD(getTotalUSDValue().toString())}</p>
            <p className="text-muted-foreground">Total Portfolio Value</p>
          </div>

          {/* Token Balances */}
          <div className="space-y-4">
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse bg-muted/20 h-16 rounded-lg" />
              ))
            ) : (
              balances.map((balance) => (
                <div key={balance.symbol} className="flex items-center justify-between p-4 bg-muted/5 rounded-lg border border-border/50">
                  <div className="flex items-center gap-3">
                    {getTokenIcon(balance.symbol)}
                    <div>
                      <p className="font-semibold">{balance.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {balance.network}
                        </Badge>
                        <div className={`flex items-center gap-1 ${getChangeColor(balance.change24h)}`}>
                          {getChangeIcon(balance.change24h)}
                          <span className="text-xs">
                            {balance.change24h > 0 ? '+' : ''}{balance.change24h.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatBalance(balance.balance)} {balance.symbol}</p>
                    <p className="text-sm text-muted-foreground">{formatUSD(balance.usdValue)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Swap Limits */}
      {swapLimits && (
        <Card className="glassmorphism">
          <CardHeader>
            <CardTitle>Cross-Chain Swap Limits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              {/* BTC → STRK */}
              <div className="p-4 bg-muted/5 rounded-lg border border-border/50">
                <div className="flex items-center gap-2 mb-3">
                  <Bitcoin className="w-5 h-5 text-orange-500" />
                  <span>→</span>
                  <Zap className="w-5 h-5 text-purple-500" />
                  <span className="font-semibold">BTC → STRK</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Min Amount:</span>
                    <span>{formatLimitAmount(swapLimits.btc_to_strk.input.min, 'BTC')} BTC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Amount:</span>
                    <span>{formatLimitAmount(swapLimits.btc_to_strk.input.max, 'BTC')} BTC</span>
                  </div>
                </div>
              </div>

              {/* STRK → BTC */}
              <div className="p-4 bg-muted/5 rounded-lg border border-border/50">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-5 h-5 text-purple-500" />
                  <span>→</span>
                  <Bitcoin className="w-5 h-5 text-orange-500" />
                  <span className="font-semibold">STRK → BTC</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Min Amount:</span>
                    <span>{formatLimitAmount(swapLimits.strk_to_btc.input.min, 'STRK')} STRK</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Amount:</span>
                    <span>{formatLimitAmount(swapLimits.strk_to_btc.input.max, 'STRK')} STRK</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}