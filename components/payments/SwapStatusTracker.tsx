"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Bitcoin,
  Coins,
  Zap,
  ArrowRight
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

// Import SwapTransaction type from BtcSwap
interface SwapTransaction {
  id: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  txHash?: string;
  createdAt: string;
  estimatedTime?: string;
}

interface SwapStatus {
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
  confirmations?: number;
  target_confirmations?: number;
  estimated_completion?: string;
}

interface SwapStatusTrackerProps {
  swap?: SwapTransaction | SwapStatus;
  swapId?: string;
  onClose?: () => void;
}

export function SwapStatusTracker({ swap, swapId, onClose }: SwapStatusTrackerProps) {
  const [status, setStatus] = useState<SwapStatus | null>(null);
  const [isLoading, setIsLoading] = useState(!swap);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (swap) {
      // Convert SwapTransaction to SwapStatus format if needed
      if ('id' in swap) {
        // This is a SwapTransaction, convert to SwapStatus
        const swapTransaction = swap as SwapTransaction;
        const convertedStatus: SwapStatus = {
          swap_id: swapTransaction.id,
          state: swapTransaction.status,
          from_token: swapTransaction.fromToken,
          to_token: swapTransaction.toToken,
          from_amount: swapTransaction.fromAmount,
          to_amount: swapTransaction.toAmount,
          created_at: swapTransaction.createdAt,
          source_tx_hash: swapTransaction.txHash,
          estimated_completion: swapTransaction.estimatedTime
        };
        setStatus(convertedStatus);
      } else {
        // This is already a SwapStatus
        setStatus(swap as SwapStatus);
      }
      setIsLoading(false);
    } else if (swapId) {
      loadSwapStatus();
      // Set up polling for active swaps
      const interval = setInterval(loadSwapStatus, 10000); // Poll every 10 seconds
      return () => clearInterval(interval);
    }
  }, [swapId, swap]);

  const loadSwapStatus = async () => {
    if (!swapId) return;
    
    try {
      const token = localStorage.getItem('engipay-token');
      if (!token) {
        throw new Error('No authentication token');
      }

      const response = await fetch(`/api/swap/atomiq/status/${swapId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setStatus(data);
        setError(null);
      } else {
        throw new Error('Failed to load swap status');
      }
    } catch (error) {
      console.error('Error loading swap status:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const refreshStatus = async () => {
    setIsRefreshing(true);
    await loadSwapStatus();
  };

  const getTokenIcon = (token: string) => {
    switch (token) {
      case 'BTC':
        return <Bitcoin className="w-5 h-5" />;
      case 'ETH':
        return <Coins className="w-5 h-5" />;
      case 'STRK':
        return <Zap className="w-5 h-5" />;
      default:
        return <Coins className="w-5 h-5" />;
    }
  };

  const getStatusInfo = (state: string) => {
    switch (state.toLowerCase()) {
      case 'pending':
        return {
          icon: <Clock className="w-5 h-5 text-yellow-500" />,
          color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
          progress: 25,
          message: 'Swap initiated, waiting for confirmation'
        };
      case 'waiting_for_bitcoin_confirmation':
        return {
          icon: <Clock className="w-5 h-5 text-blue-500" />,
          color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
          progress: 50,
          message: 'Waiting for Bitcoin transaction confirmation'
        };
      case 'bitcoin_confirmed':
        return {
          icon: <CheckCircle className="w-5 h-5 text-green-500" />,
          color: 'bg-green-500/20 text-green-300 border-green-500/30',
          progress: 75,
          message: 'Bitcoin transaction confirmed, processing settlement'
        };
      case 'completed':
      case 'settled':
        return {
          icon: <CheckCircle className="w-5 h-5 text-green-500" />,
          color: 'bg-green-500/20 text-green-300 border-green-500/30',
          progress: 100,
          message: 'Swap completed successfully'
        };
      case 'failed':
        return {
          icon: <XCircle className="w-5 h-5 text-red-500" />,
          color: 'bg-red-500/20 text-red-300 border-red-500/30',
          progress: 0,
          message: 'Swap failed'
        };
      case 'expired':
        return {
          icon: <XCircle className="w-5 h-5 text-red-500" />,
          color: 'bg-red-500/20 text-red-300 border-red-500/30',
          progress: 0,
          message: 'Swap expired'
        };
      default:
        return {
          icon: <AlertCircle className="w-5 h-5 text-blue-500" />,
          color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
          progress: 10,
          message: 'Processing swap'
        };
    }
  };

  const formatAmount = (amount: string, decimals: number = 8) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    return num.toFixed(decimals).replace(/\.?0+$/, '');
  };

  const getExplorerUrl = (txHash: string, token: string) => {
    if (token === 'BTC') {
      return `https://mempool.space/tx/${txHash}`;
    } else {
      return `https://starkscan.co/tx/${txHash}`;
    }
  };

  if (isLoading) {
    return (
      <Card className="glassmorphism">
        <CardContent className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted/20 rounded w-3/4" />
            <div className="h-4 bg-muted/20 rounded w-1/2" />
            <div className="h-8 bg-muted/20 rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="glassmorphism border-red-500/30">
        <CardContent className="p-8 text-center">
          <XCircle className="w-12 h-12 mx-auto text-red-500 mb-4" />
          <p className="text-red-400 mb-4">{error}</p>
          <Button onClick={loadSwapStatus} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card className="glassmorphism">
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Swap not found</p>
        </CardContent>
      </Card>
    );
  }

  const statusInfo = getStatusInfo(status.state);

  return (
    <Card className="glassmorphism">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {statusInfo.icon}
            Swap Status
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshStatus}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                ×
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Swap Details */}
        <div className="flex items-center justify-center gap-4 p-4 bg-muted/10 rounded-lg">
          <div className="flex items-center gap-2">
            {getTokenIcon(status.from_token)}
            <div className="text-center">
              <p className="font-semibold">{formatAmount(status.from_amount)}</p>
              <p className="text-sm text-muted-foreground">{status.from_token}</p>
            </div>
          </div>
          <ArrowRight className="w-6 h-6 text-primary" />
          <div className="flex items-center gap-2">
            {getTokenIcon(status.to_token)}
            <div className="text-center">
              <p className="font-semibold">{formatAmount(status.to_amount)}</p>
              <p className="text-sm text-muted-foreground">{status.to_token}</p>
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <div className="text-center">
          <Badge className={`${statusInfo.color} px-4 py-2 text-base`}>
            <div className="flex items-center gap-2">
              {statusInfo.icon}
              {status.state.replace(/_/g, ' ').toUpperCase()}
            </div>
          </Badge>
          <p className="text-sm text-muted-foreground mt-2">{statusInfo.message}</p>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Progress</span>
            <span>{statusInfo.progress}%</span>
          </div>
          <Progress value={statusInfo.progress} className="h-2" />
        </div>

        {/* Confirmation Progress */}
        {status.confirmations !== undefined && status.target_confirmations && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Confirmations</span>
              <span>{status.confirmations}/{status.target_confirmations}</span>
            </div>
            <Progress 
              value={(status.confirmations / status.target_confirmations) * 100} 
              className="h-2" 
            />
          </div>
        )}

        {/* Transaction Links */}
        <div className="space-y-3">
          {status.source_tx_hash && (
            <div className="flex items-center justify-between p-3 bg-muted/5 rounded-lg">
              <div>
                <p className="font-medium">Source Transaction</p>
                <p className="text-sm text-muted-foreground">
                  {status.source_tx_hash.slice(0, 10)}...{status.source_tx_hash.slice(-10)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(getExplorerUrl(status.source_tx_hash!, status.from_token), '_blank')}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          )}

          {status.destination_tx_hash && (
            <div className="flex items-center justify-between p-3 bg-muted/5 rounded-lg">
              <div>
                <p className="font-medium">Destination Transaction</p>
                <p className="text-sm text-muted-foreground">
                  {status.destination_tx_hash.slice(0, 10)}...{status.destination_tx_hash.slice(-10)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(getExplorerUrl(status.destination_tx_hash!, status.to_token), '_blank')}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Additional Info */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Swap ID</p>
            <p className="font-mono">{status.swap_id.slice(0, 16)}...</p>
          </div>
          {status.fee && (
            <div>
              <p className="text-muted-foreground">Fee</p>
              <p>{formatAmount(status.fee)} {status.from_token}</p>
            </div>
          )}
          {status.expires_at && (
            <div className="col-span-2">
              <p className="text-muted-foreground">Expires</p>
              <p>{new Date(status.expires_at).toLocaleString()}</p>
            </div>
          )}
          {status.estimated_completion && (
            <div className="col-span-2">
              <p className="text-muted-foreground">Estimated Completion</p>
              <p>{new Date(status.estimated_completion).toLocaleString()}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}