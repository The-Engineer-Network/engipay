"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { escrowService } from '@/lib/starknet';
import { toast } from '@/hooks/use-toast';

interface PaymentRequest {
  id: string;
  sender: string;
  recipient: string;
  amount: string;
  token: string;
  status: number;
  created_at: number;
  expires_at: number;
  memo: string;
}

export function EscrowPayments() {
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('0x0'); // 0x0 for ETH, or token address
  const [memo, setMemo] = useState('');
  const [expiryHours, setExpiryHours] = useState('24');
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { walletAddress } = useWallet();

  useEffect(() => {
    loadPaymentRequests();
  }, [walletAddress]);

  const loadPaymentRequests = async () => {
    if (!walletAddress) return;

    setIsLoading(true);
    try {
      // In a real implementation, you'd fetch payment requests from your backend
      // For now, we'll show a placeholder
      setPaymentRequests([]);
    } catch (error) {
      console.error('Error loading payment requests:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreatePaymentRequest = async () => {
    if (!recipient || !amount || !walletAddress) return;

    setIsCreating(true);
    try {
      toast({
        title: 'Creating Payment Request',
        description: `Creating escrow payment request for ${amount} tokens...`,
      });

      // Reset form
      setRecipient('');
      setAmount('');
      setMemo('');
      setExpiryHours('24');

      await loadPaymentRequests();
    } catch (error: any) {
      toast({
        title: 'Creation Failed',
        description: error.message || 'Failed to create payment request',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleAcceptPayment = async (requestId: string) => {
    try {
      toast({
        title: 'Accepting Payment',
        description: 'Accepting payment request...',
      });

      await loadPaymentRequests();
    } catch (error: any) {
      toast({
        title: 'Acceptance Failed',
        description: error.message || 'Failed to accept payment',
        variant: 'destructive',
      });
    }
  };

  const handleRejectPayment = async (requestId: string) => {
    try {
      toast({
        title: 'Rejecting Payment',
        description: 'Rejecting payment request...',
      });

      await loadPaymentRequests();
    } catch (error: any) {
      toast({
        title: 'Rejection Failed',
        description: error.message || 'Failed to reject payment',
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0: // Pending
        return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 1: // Accepted
        return <Badge variant="secondary" className="bg-green-500/20 text-green-400"><CheckCircle className="w-3 h-3 mr-1" />Accepted</Badge>;
      case 2: // Rejected
        return <Badge variant="secondary" className="bg-red-500/20 text-red-400"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      case 3: // Cancelled
        return <Badge variant="secondary" className="bg-gray-500/20 text-gray-400"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      case 4: // Expired
        return <Badge variant="secondary" className="bg-orange-500/20 text-orange-400"><AlertCircle className="w-3 h-3 mr-1" />Expired</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <div className="space-y-6">
      {/* Create Payment Request */}
      <Card className="glassmorphism">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Create Escrow Payment Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Recipient Address</label>
              <Input
                placeholder="0x..."
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="glassmorphism"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Amount</label>
              <Input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="glassmorphism"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Token</label>
              <Select value={token} onValueChange={setToken}>
                <SelectTrigger className="glassmorphism">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0x0">ETH</SelectItem>
                  <SelectItem value="ENGI_TOKEN_ADDRESS">ENGI</SelectItem>
                  <SelectItem value="USDC_ADDRESS">USDC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Expiry (hours)</label>
              <Select value={expiryHours} onValueChange={setExpiryHours}>
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
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Memo (optional)</label>
            <Textarea
              placeholder="Payment description..."
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="glassmorphism"
              rows={3}
            />
          </div>

          <Button
            onClick={handleCreatePaymentRequest}
            disabled={isCreating || !recipient || !amount}
            className="glow-button bg-primary hover:bg-primary/90 w-full"
          >
            {isCreating ? 'Creating...' : 'Create Escrow Payment Request'}
          </Button>
        </CardContent>
      </Card>

      {/* Payment Requests */}
      <Card className="glassmorphism">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Payment Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading payment requests...</p>
            </div>
          ) : paymentRequests.length === 0 ? (
            <div className="text-center py-8">
              <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No payment requests found</p>
              <p className="text-sm text-muted-foreground mt-2">
                Create your first escrow payment request above
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {paymentRequests.map((request) => (
                <div key={request.id} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="text-sm">
                        <p className="font-medium">Request #{request.id}</p>
                        <p className="text-muted-foreground">
                          From: {formatAddress(request.sender)}
                        </p>
                      </div>
                      {getStatusBadge(request.status)}
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{request.amount} {request.token === '0x0' ? 'ETH' : 'ENGI'}</p>
                      <p className="text-sm text-muted-foreground">
                        Expires: {new Date(request.expires_at * 1000).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {request.memo && (
                    <p className="text-sm text-muted-foreground mb-3">{request.memo}</p>
                  )}

                  {/* Action buttons for pending requests */}
                  {request.status === 0 && request.recipient.toLowerCase() === walletAddress?.toLowerCase() && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleAcceptPayment(request.id)}
                        className="bg-green-500 hover:bg-green-500/90 text-white"
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRejectPayment(request.id)}
                        className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}