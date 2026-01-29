"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Clock, 
  ArrowLeftRight, 
  ExternalLink, 
  RefreshCw,
  Bitcoin,
  Coins,
  Zap,
  AlertCircle,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { toast } from '@/hooks/use-toast';

interface SwapHistoryItem {
  swap_id: string;
  state: string;
  from_token: string;
  to_token: string;
  from_amount: string;
  to_amount: string;
  fee?: string;
  expiry?: number;
  expires_at?: string;
  created_at?: string;
  source_tx_hash?: string;
  destination_tx_hash?: string;
}

interface ClaimableSwap extends SwapHistoryItem {
  claimable: true;
}

interface RefundableSwap extends SwapHistoryItem {
  refundable: true;
}

export function SwapHistory() {
  const [swaps, setSwaps] = useState<SwapHistoryItem[]>([]);
  const [claimableSwaps, setClaimableSwaps] = useState<ClaimableSwap[]>([]);
  const [refundableSwaps, setRefundableSwaps] = useState<RefundableSwap[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { isConnected } = useWallet();

  useEffect(() => {
    if (isConnected) {
      loadSwapHistory();
    }
  }, [isConnected]);

  const loadSwapHistory = async () => {
    if (!isConnected) return;

    setIsLoading(true);
    try {
      const token = localStorage.getItem('engipay-token');
      if (!token) {
        throw new Error('No authentication token');
      }

      // Load all swap data in parallel
      const [historyRes, claimableRes, refundableRes] = await Promise.all([
        fetch('/api/swap/atomiq/history', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/swap/atomiq/claimable', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/swap/atomiq/refundable', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setSwaps(historyData.swaps || []);
      }

      if (claimableRes.ok) {
        const claimableData = await claimableRes.json();
        setClaimableSwaps(claimableData.swaps || []);
      }

      if (refundableRes.ok) {
        const refundableData = await refundableRes.json();
        setRefundableSwaps(refundableData.swaps || []);
      }

    } catch (error) {
      console.error('Error loading swap history:', error);
      toast({
        title: 'Error',
        description: 'Failed to load swap history',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const refreshHistory = async () => {
    setIsRefreshing(true);
    await loadSwapHistory();
    setIsRefreshing(false);
  };

  const handleClaim = async (swapId: string) => {
    try {
      const token = localStorage.getItem('engipay-token');
      if (!token) throw new Error('No authentication token');

      // This would need wallet integration for signing
      const wallet = {}; // TODO: Get actual wallet signer

      const response = await fetch(`/api/swap/atomiq/${swapId}/claim`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ wallet })
      });

      if (response.ok) {
        toast({
          title: 'Claim Successful',
          description: 'Swap has been claimed successfully',
        });
        await refreshHistory();
      } else {
        throw new Error('Claim failed');
      }
    } catch (error) {
      console.error('Claim error:', error);
      toast({
        title: 'Claim Failed',
        description: 'Failed to claim swap',
        variant: 'destructive',
      });
    }
  };

  const handleRefund = async (swapId: string) => {
    try {
      const token = localStorage.getItem('engipay-token');
      if (!token) throw new Error('No authentication token');

      // This would need wallet integration for signing
      const wallet = {}; // TODO: Get actual wallet signer

      const response = await fetch(`/api/swap/atomiq/${swapId}/refund`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ wallet })
      });

      if (response.ok) {
        toast({
          title: 'Refund Successful',
          description: 'Swap has been refunded successfully',
        });
        await refreshHistory();
      } else {
        throw new Error('Refund failed');
      }
    } catch (error) {
      console.error('Refund error:', error);
      toast({
        title: 'Refund Failed',
        description: 'Failed to refund swap',
        variant: 'destructive',
      });
    }
  };

  const getTokenIcon = (token: string) => {
    switch (token) {
      case 'BTC':
        return <Bitcoin className="w-4 h-4" />;
      case 'ETH':
        return <Coins className="w-4 h-4" />;
      case 'STRK':
        return <Zap className="w-4 h-4" />;
      default:
        return <Coins className="w-4 h-4" />;
    }
  };

  const getStatusIcon = (state: string) => {
    switch (state.toLowerCase()) {
      case 'completed':
      case 'settled':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
      case 'expired':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'pending':
      case 'waiting':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-blue-500" />;
    }
  };

  const getStatusColor = (state: string) => {
    switch (state.toLowerCase()) {
      case 'completed':
      case 'settled':
        return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'failed':
      case 'expired':
        return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'pending':
      case 'waiting':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      default:
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    }
  };

  const formatAmount = (amount: string, decimals: number = 8) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    return num.toFixed(decimals).replace(/\.?0+$/, '');
  };

  if (!isConnected) {
    return (
      <Card className="glassmorphism">
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Connect your wallet to view swap history</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Claimable Swaps */}
      {claimableSwaps.length > 0 && (
        <Card className="glassmorphism border-green-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-400">
              <CheckCircle className="w-5 h-5" />
              Claimable Swaps ({claimableSwaps.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {claimableSwaps.map((swap) => (
                <div key={swap.swap_id} className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      {getTokenIcon(swap.from_token)}
                      <ArrowLeftRight className="w-3 h-3" />
                      {getTokenIcon(swap.to_token)}
                    </div>
                    <div>
                      <p className="font-medium">
                        {formatAmount(swap.from_amount)} {swap.from_token} → {formatAmount(swap.to_amount)} {swap.to_token}
                      </p>
                      <p className="text-sm text-muted-foreground">Ready to claim</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleClaim(swap.swap_id)}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    Claim
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refundable Swaps */}
      {refundableSwaps.length > 0 && (
        <Card className="glassmorphism border-orange-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-400">
              <RefreshCw className="w-5 h-5" />
              Refundable Swaps ({refundableSwaps.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {refundableSwaps.map((swap) => (
                <div key={swap.swap_id} className="flex items-center justify-between p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      {getTokenIcon(swap.from_token)}
                      <ArrowLeftRight className="w-3 h-3" />
                      {getTokenIcon(swap.to_token)}
                    </div>
                    <div>
                      <p className="font-medium">
                        {formatAmount(swap.from_amount)} {swap.from_token}
                      </p>
                      <p className="text-sm text-muted-foreground">Available for refund</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRefund(swap.swap_id)}
                    className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
                  >
                    Refund
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Swap History */}
      <Card className="glassmorphism">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Swap History
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshHistory}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse bg-muted/20 h-16 rounded-lg" />
              ))}
            </div>
          ) : swaps.length === 0 ? (
            <div className="text-center py-8">
              <ArrowLeftRight className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No swaps yet</p>
              <p className="text-sm text-muted-foreground">Your cross-chain swaps will appear here</p>
            </div>
          ) : (
            <ScrollArea className="h-96">
              <div className="space-y-3">
                {swaps.map((swap) => (
                  <div key={swap.swap_id} className="p-4 border border-border/50 rounded-lg hover:bg-muted/5 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          {getTokenIcon(swap.from_token)}
                          <ArrowLeftRight className="w-3 h-3" />
                          {getTokenIcon(swap.to_token)}
                        </div>
                        <div>
                          <p className="font-medium">
                            {formatAmount(swap.from_amount)} {swap.from_token} → {formatAmount(swap.to_amount)} {swap.to_token}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            ID: {swap.swap_id.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={getStatusColor(swap.state)}>
                          <div className="flex items-center gap-1">
                            {getStatusIcon(swap.state)}
                            {swap.state}
                          </div>
                        </Badge>
                        {swap.source_tx_hash && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              // Open transaction in explorer
                              const explorerUrl = swap.from_token === 'BTC' 
                                ? `https://mempool.space/tx/${swap.source_tx_hash}`
                                : `https://starkscan.co/tx/${swap.source_tx_hash}`;
                              window.open(explorerUrl, '_blank');
                            }}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {swap.expires_at && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Expires: {new Date(swap.expires_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}