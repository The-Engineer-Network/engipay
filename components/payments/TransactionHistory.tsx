"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Send,
  ArrowLeftRight,
  Clock,
  Filter,
  Calendar,
  Search,
  ExternalLink,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { toast } from '@/hooks/use-toast';

interface Transaction {
  id: string;
  type: string;
  description: string;
  amount: string;
  asset: string;
  value_usd: number | null;
  status: string;
  timestamp: string;
  tx_hash: string | null;
  network: string;
  to_address: string | null;
  from_address: string | null;
}

export function TransactionHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    type: 'all',
    status: 'all',
    asset: 'all',
    dateRange: 'all'
  });
  const { isConnected } = useWallet();

  useEffect(() => {
    if (isConnected) {
      loadTransactions();
    }
  }, [isConnected, filters]);

  const loadTransactions = async () => {
    if (!isConnected) return;

    setIsLoading(true);
    try {
      const token = localStorage.getItem('engipay-token');
      if (!token) {
        throw new Error('No authentication token');
      }

      // Build query parameters
      const params = new URLSearchParams({
        limit: '50',
        offset: '0'
      });

      if (filters.type !== 'all') params.append('type', filters.type);
      if (filters.status !== 'all') params.append('status', filters.status);
      if (filters.asset !== 'all') params.append('asset', filters.asset);

      // Date range filter
      if (filters.dateRange !== 'all') {
        const now = new Date();
        let startDate: Date;

        switch (filters.dateRange) {
          case 'today':
            startDate = new Date(now.setHours(0, 0, 0, 0));
            break;
          case 'week':
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
          case 'month':
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            break;
          default:
            startDate = new Date(0);
        }

        params.append('start_date', startDate.toISOString());
      }

      const response = await fetch(`/api/transactions?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }

      const data = await response.json();
      setTransactions(data.transactions || []);
    } catch (error: any) {
      console.error('Error loading transactions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load transaction history',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const refreshTransactions = async () => {
    setIsRefreshing(true);
    await loadTransactions();
    setIsRefreshing(false);
  };

  const filteredTransactions = transactions.filter(tx => {
    if (!searchQuery) return true;
    
    const query = searchQuery.toLowerCase();
    return (
      tx.id.toLowerCase().includes(query) ||
      tx.description.toLowerCase().includes(query) ||
      tx.tx_hash?.toLowerCase().includes(query) ||
      tx.to_address?.toLowerCase().includes(query) ||
      tx.from_address?.toLowerCase().includes(query)
    );
  });

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'confirmed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
      case 'rejected':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'pending':
      case 'processing':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-blue-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'confirmed':
        return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'failed':
      case 'rejected':
        return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'pending':
      case 'processing':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      default:
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'send':
      case 'payment':
        return <Send className="w-4 h-4" />;
      case 'swap':
      case 'cross_chain_swap':
        return <ArrowLeftRight className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getExplorerUrl = (txHash: string, network: string) => {
    switch (network.toLowerCase()) {
      case 'starknet':
        return `https://starkscan.co/tx/${txHash}`;
      case 'ethereum':
        return `https://etherscan.io/tx/${txHash}`;
      case 'bitcoin':
        return `https://mempool.space/tx/${txHash}`;
      default:
        return `https://starkscan.co/tx/${txHash}`;
    }
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  if (!isConnected) {
    return (
      <Card className="glassmorphism">
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Connect your wallet to view transaction history</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters and Search */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by hash, address, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 glassmorphism"
            />
          </div>
        </div>
        
        <div className="flex gap-2">
          <Select value={filters.type} onValueChange={(value) => setFilters({ ...filters, type: value })}>
            <SelectTrigger className="w-32 glassmorphism">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="send">Payments</SelectItem>
              <SelectItem value="swap">Swaps</SelectItem>
              <SelectItem value="escrow">Escrow</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.status} onValueChange={(value) => setFilters({ ...filters, status: value })}>
            <SelectTrigger className="w-32 glassmorphism">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.dateRange} onValueChange={(value) => setFilters({ ...filters, dateRange: value })}>
            <SelectTrigger className="w-32 glassmorphism">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={refreshTransactions}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Transaction List */}
      <Card className="glassmorphism">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No transactions found matching your search' : 'No transactions yet'}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                {searchQuery ? 'Try adjusting your filters' : 'Your transactions will appear here'}
              </p>
            </div>
          ) : (
            <ScrollArea className="h-96">
              <div className="divide-y divide-border">
                {filteredTransactions.map((tx) => (
                  <div key={tx.id} className="p-4 hover:bg-muted/10 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`p-2 rounded-full ${
                          tx.type === 'send' ? 'bg-[#22D3EE]/20' : 'bg-[#34D399]/20'
                        }`}>
                          {getTypeIcon(tx.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{tx.description}</p>
                            <Badge className={getStatusColor(tx.status)}>
                              <div className="flex items-center gap-1">
                                {getStatusIcon(tx.status)}
                                {tx.status}
                              </div>
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                            <span>{formatDate(tx.timestamp)}</span>
                            {tx.tx_hash && (
                              <>
                                <span>•</span>
                                <span className="truncate max-w-32">{tx.tx_hash.slice(0, 10)}...</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className={`font-semibold ${
                            tx.amount.startsWith('-') ? 'text-red-500' : 'text-green-500'
                          }`}>
                            {tx.amount} {tx.asset}
                          </p>
                          {tx.value_usd && (
                            <p className="text-sm text-muted-foreground">
                              ${tx.value_usd.toFixed(2)}
                            </p>
                          )}
                        </div>
                        {tx.tx_hash && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(getExplorerUrl(tx.tx_hash!, tx.network), '_blank')}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      {filteredTransactions.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
