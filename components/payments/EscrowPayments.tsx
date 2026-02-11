"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Clock, CheckCircle, XCircle, AlertCircle, ExternalLink, Loader2, QrCode } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { toast } from '@/hooks/use-toast';

interface PaymentRequest {
  request_id: string;
  sender: string;
  recipient: string;
  amount: string;
  token: string;
  status: string;
  created_at: string;
  expires_at: string;
  memo: string;
  payment_link?: string;
}

export function EscrowPayments() {
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('STRK');
  const [memo, setMemo] = useState('');
  const [expiryHours, setExpiryHours] = useState('24');
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);
  const [txHash, setTxHash] = useState('');

  const { walletAddress, isConnected, starknetAccount } = useWallet();

  useEffect(() => {
    if (isConnected && walletAddress) {
      loadPaymentRequests();
    }
  }, [walletAddress, isConnected]);

  const loadPaymentRequests = async () => {
    if (!walletAddress) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/escrow/requests?type=all`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
          },
        }
      );

      const data = await response.json();

      if (response.ok) {
        setPaymentRequests(data.requests || []);
      }
    } catch (error) {
      console.error('Error loading payment requests:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreatePaymentRequest = async () => {
    if (!recipient || !amount || !walletAddress || !starknetAccount) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields and connect wallet',
        variant: 'destructive',
      });
      return;
    }

    setIsCreating(true);
    setTxHash('');

    try {
      // Step 1: Prepare escrow request
      const prepareResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/escrow/create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
          },
          body: JSON.stringify({
            to_address: recipient,
            amount,
            asset,
            expiry_hours: parseInt(expiryHours),
            memo,
          }),
        }
      );

      const prepareData = await prepareResponse.json();

      if (!prepareResponse.ok) {
        throw new Error(prepareData.error?.message || 'Failed to prepare escrow request');
      }

      toast({
        title: 'Please sign transaction',
        description: 'Confirm the escrow creation in your wallet',
      });

      // Step 2: Sign transaction with wallet
      const { transaction_hash } = await starknetAccount.execute({
        contractAddress: prepareData.transaction_data.contract_address,
        entrypoint: prepareData.transaction_data.entry_point,
        calldata: [recipient, amount],
      });

      setTxHash(transaction_hash);

      toast({
        title: 'Transaction submitted',
        description: 'Creating escrow payment request...',
      });

      // Step 3: Submit transaction hash to backend
      const executeResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/escrow/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
          },
          body: JSON.stringify({
            transaction_id: prepareData.transaction_id,
            tx_hash: transaction_hash,
            action: 'create',
          }),
        }
      );

      const executeData = await executeResponse.json();

      if (!executeResponse.ok) {
        throw new Error(executeData.error?.message || 'Failed to execute escrow request');
      }

      toast({
        title: 'Escrow Request Created! 🎉',
        description: (
          <div className="flex flex-col gap-2">
            <p>Payment request created successfully</p>
            <p className="text-xs">Payment Link: {prepareData.payment_link}</p>
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
      });

      // Reset form
      setRecipient('');
      setAmount('');
      setMemo('');
      setExpiryHours('24');

      // Reload requests
      await loadPaymentRequests();
    } catch (error: any) {
      console.error('Escrow creation error:', error);
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
    if (!starknetAccount) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet',
        variant: 'destructive',
      });
      return;
    }

    setProcessingRequest(requestId);

    try {
      // Step 1: Prepare accept transaction
      const prepareResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/escrow/accept`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
          },
          body: JSON.stringify({ request_id: requestId }),
        }
      );

      const prepareData = await prepareResponse.json();

      if (!prepareResponse.ok) {
        throw new Error(prepareData.error?.message || 'Failed to prepare accept');
      }

      toast({
        title: 'Please sign transaction',
        description: 'Confirm to accept the payment',
      });

      // Step 2: Sign transaction
      const { transaction_hash } = await starknetAccount.execute({
        contractAddress: prepareData.transaction_data.contract_address,
        entrypoint: prepareData.transaction_data.entry_point,
        calldata: [requestId],
      });

      // Step 3: Submit transaction hash
      const executeResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/escrow/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
          },
          body: JSON.stringify({
            transaction_id: prepareData.transaction_id,
            tx_hash: transaction_hash,
            action: 'accept',
          }),
        }
      );

      const executeData = await executeResponse.json();

      if (!executeResponse.ok) {
        throw new Error(executeData.error?.message || 'Failed to execute accept');
      }

      toast({
        title: 'Payment Accepted! ✅',
        description: 'Funds will be released to you',
      });

      await loadPaymentRequests();
    } catch (error: any) {
      console.error('Accept error:', error);
      toast({
        title: 'Acceptance Failed',
        description: error.message || 'Failed to accept payment',
        variant: 'destructive',
      });
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleRejectPayment = async (requestId: string) => {
    if (!starknetAccount) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet',
        variant: 'destructive',
      });
      return;
    }

    setProcessingRequest(requestId);

    try {
      // Step 1: Prepare reject transaction
      const prepareResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/escrow/reject`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
          },
          body: JSON.stringify({ request_id: requestId }),
        }
      );

      const prepareData = await prepareResponse.json();

      if (!prepareResponse.ok) {
        throw new Error(prepareData.error?.message || 'Failed to prepare reject');
      }

      toast({
        title: 'Please sign transaction',
        description: 'Confirm to reject the payment',
      });

      // Step 2: Sign transaction
      const { transaction_hash } = await starknetAccount.execute({
        contractAddress: prepareData.transaction_data.contract_address,
        entrypoint: prepareData.transaction_data.entry_point,
        calldata: [requestId],
      });

      // Step 3: Submit transaction hash
      const executeResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/escrow/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
          },
          body: JSON.stringify({
            transaction_id: prepareData.transaction_id,
            tx_hash: transaction_hash,
            action: 'reject',
          }),
        }
      );

      const executeData = await executeResponse.json();

      if (!executeResponse.ok) {
        throw new Error(executeData.error?.message || 'Failed to execute reject');
      }

      toast({
        title: 'Payment Rejected ❌',
        description: 'Funds will be returned to sender',
      });

      await loadPaymentRequests();
    } catch (error: any) {
      console.error('Reject error:', error);
      toast({
        title: 'Rejection Failed',
        description: error.message || 'Failed to reject payment',
        variant: 'destructive',
      });
    } finally {
      setProcessingRequest(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'accepted':
        return <Badge variant="secondary" className="bg-green-500/20 text-green-400"><CheckCircle className="w-3 h-3 mr-1" />Accepted</Badge>;
      case 'rejected':
        return <Badge variant="secondary" className="bg-red-500/20 text-red-400"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      case 'cancelled':
        return <Badge variant="secondary" className="bg-gray-500/20 text-gray-400"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      case 'expired':
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
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger className="glassmorphism">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STRK">STRK</SelectItem>
                  <SelectItem value="ETH">ETH</SelectItem>
                  <SelectItem value="ENGI">ENGI</SelectItem>
                  <SelectItem value="USDC">USDC</SelectItem>
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
            disabled={isCreating || !recipient || !amount || !isConnected}
            className="glow-button bg-primary hover:bg-primary/90 w-full"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Escrow Payment Request'
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
                <div key={request.request_id} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="text-sm">
                        <p className="font-medium">Request #{request.request_id.substring(0, 8)}...</p>
                        <p className="text-muted-foreground">
                          From: {formatAddress(request.sender)}
                        </p>
                      </div>
                      {getStatusBadge(request.status)}
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{request.amount} {request.token}</p>
                      <p className="text-sm text-muted-foreground">
                        Expires: {new Date(request.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {request.memo && (
                    <p className="text-sm text-muted-foreground mb-3">{request.memo}</p>
                  )}

                  {/* Action buttons for pending requests */}
                  {request.status === 'pending' && request.recipient.toLowerCase() === walletAddress?.toLowerCase() && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleAcceptPayment(request.request_id)}
                        disabled={processingRequest === request.request_id}
                        className="bg-green-500 hover:bg-green-500/90 text-white"
                      >
                        {processingRequest === request.request_id ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Accepting...
                          </>
                        ) : (
                          'Accept'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRejectPayment(request.request_id)}
                        disabled={processingRequest === request.request_id}
                        className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                      >
                        {processingRequest === request.request_id ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Rejecting...
                          </>
                        ) : (
                          'Reject'
                        )}
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