# Xverse Wallet API and Atomiq SDK Frontend Integration Guide

## Overview

This guide provides a comprehensive step-by-step implementation for integrating Xverse Wallet API and Atomiq SDK into EngiPay. The integration enables native Bitcoin support and cross-chain swaps (BTC ↔ ETH/STRK) directly from the frontend.

### Why Xverse and Atomiq?

- **Xverse Wallet API**: Provides native Bitcoin wallet integration, handling UTXO model, Ordinals, BRC-20 tokens, and direct BTC transactions.
- **Atomiq SDK**: Enables seamless cross-chain swaps, abstracting complex blockchain interactions for BTC ↔ ETH/STRK conversions.

## Prerequisites

- Node.js and npm installed
- EngiPay Next.js project setup
- Xverse Wallet API key: `ad11e923-9bd7-4028-ac42-5c710734f8d4`
- Trial limits: 2 RPS (100 RPM), expires in 10 days

## 1. Installation and Setup

### Install Dependencies

```bash
npm install @xverse/wallet-api atomiq-sdk
```

### Environment Configuration

Add to `.env.local`:

```env
XVERSE_API_KEY=ad11e923-9bd7-4028-ac42-5c710734f8d4
XVERSE_ENDPOINT=https://api.secretkeylabs.io
ATOMIQ_SDK_ENV=testnet  # or mainnet
```

## 2. Xverse Wallet API Integration

### Initialize Xverse Provider

Create `lib/xverse.ts`:

```typescript
import { XverseWallet } from '@xverse/wallet-api';

export const xverseWallet = new XverseWallet({
  apiKey: process.env.XVERSE_API_KEY,
  endpoint: process.env.XVERSE_ENDPOINT,
});

// Types for Bitcoin operations
export interface BitcoinTransaction {
  to: string;
  amount: number; // in satoshis
  feeRate?: number;
}

export interface WalletBalance {
  confirmed: number;
  unconfirmed: number;
  total: number;
}
```

### Wallet Connection Component

Update `components/WalletConnectModal.tsx` to include Xverse:

```typescript
import { useState } from 'react';
import { xverseWallet, WalletBalance } from '@/lib/xverse';

export function WalletConnectModal() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [btcBalance, setBtcBalance] = useState<WalletBalance | null>(null);

  const connectXverse = async () => {
    setIsConnecting(true);
    try {
      const connected = await xverseWallet.connect();
      if (connected) {
        const balance = await xverseWallet.getBalance();
        setBtcBalance(balance);
        // Update global wallet context
        // ... existing wallet context update logic
      }
    } catch (error) {
      console.error('Xverse connection failed:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="wallet-modal">
      {/* Existing wallet options */}
      <button
        onClick={connectXverse}
        disabled={isConnecting}
        className="xverse-connect-btn"
      >
        {isConnecting ? 'Connecting...' : 'Connect Xverse Wallet'}
      </button>
      {btcBalance && (
        <div className="btc-balance">
          BTC Balance: {(btcBalance.total / 100000000).toFixed(8)} BTC
        </div>
      )}
    </div>
  );
}
```

### Bitcoin Transaction Functions

Add to `lib/xverse.ts`:

```typescript
export const sendBitcoin = async (transaction: BitcoinTransaction) => {
  try {
    const txId = await xverseWallet.sendBitcoin({
      to: transaction.to,
      amount: transaction.amount,
      feeRate: transaction.feeRate || 1, // sat/vB
    });
    return { success: true, txId };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const getBitcoinBalance = async (): Promise<WalletBalance> => {
  return await xverseWallet.getBalance();
};

export const getTransactionHistory = async (limit = 10) => {
  return await xverseWallet.getTransactions({ limit });
};
```

### Ordinals and BRC-20 Support

For NFT and token support:

```typescript
export const getOrdinals = async () => {
  return await xverseWallet.getOrdinals();
};

export const sendOrdinal = async (ordinalId: string, to: string) => {
  return await xverseWallet.sendOrdinal(ordinalId, to);
};

export const getBRC20Tokens = async () => {
  return await xverseWallet.getBRC20Tokens();
};
```

## 3. Atomiq SDK Integration

### Initialize Atomiq SDK

Create `lib/atomiq.ts`:

```typescript
import { AtomiqSDK } from 'atomiq-sdk';
import { xverseWallet } from './xverse';

export const atomiq = new AtomiqSDK({
  environment: process.env.ATOMIQ_SDK_ENV as 'testnet' | 'mainnet',
  signer: xverseWallet, // Xverse as BTC signer
});

// Types
export interface SwapParams {
  fromToken: string; // 'BTC', 'ETH', 'STRK'
  toToken: string;
  amount: string;
  slippage?: number;
}

export interface SwapResult {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  details: any;
}
```

### Swap Component

Create `components/payments/BtcSwap.tsx`:

```typescript
import { useState } from 'react';
import { atomiq, SwapParams, SwapResult } from '@/lib/atomiq';

export function BtcSwap() {
  const [swapParams, setSwapParams] = useState<SwapParams>({
    fromToken: 'BTC',
    toToken: 'ETH',
    amount: '',
    slippage: 0.5,
  });
  const [swapStatus, setSwapStatus] = useState<string>('');
  const [isSwapping, setIsSwapping] = useState(false);

  const handleSwap = async () => {
    if (!swapParams.amount) return;

    setIsSwapping(true);
    setSwapStatus('Connecting Wallet...');

    try {
      // Ensure Xverse wallet is connected
      const connected = await xverseWallet.isConnected();
      if (!connected) {
        await xverseWallet.connect();
      }

      setSwapStatus('Confirming in Xverse Wallet...');

      const result: SwapResult = await atomiq.swap(swapParams);

      setSwapStatus('Transaction Pending...');

      // Poll for confirmation
      const confirmed = await pollSwapConfirmation(result.txHash);

      if (confirmed) {
        setSwapStatus(`Swap Successful! Tx: ${result.txHash}`);
      } else {
        setSwapStatus('Swap Failed');
      }
    } catch (error) {
      setSwapStatus(`Error: ${error.message}`);
    } finally {
      setIsSwapping(false);
    }
  };

  const pollSwapConfirmation = async (txHash: string): Promise<boolean> => {
    // Implement polling logic
    return new Promise((resolve) => {
      setTimeout(() => resolve(true), 30000); // Mock confirmation
    });
  };

  return (
    <div className="swap-container">
      <div className="swap-form">
        <select
          value={swapParams.fromToken}
          onChange={(e) => setSwapParams({...swapParams, fromToken: e.target.value})}
        >
          <option value="BTC">BTC</option>
          <option value="ETH">ETH</option>
          <option value="STRK">STRK</option>
        </select>

        <input
          type="number"
          placeholder="Amount"
          value={swapParams.amount}
          onChange={(e) => setSwapParams({...swapParams, amount: e.target.value})}
        />

        <select
          value={swapParams.toToken}
          onChange={(e) => setSwapParams({...swapParams, toToken: e.target.value})}
        >
          <option value="ETH">ETH</option>
          <option value="STRK">STRK</option>
          <option value="BTC">BTC</option>
        </select>

        <button
          onClick={handleSwap}
          disabled={isSwapping}
          className="swap-btn"
        >
          {isSwapping ? 'Swapping...' : 'Swap Now'}
        </button>
      </div>

      {swapStatus && (
        <div className="swap-status">
          {swapStatus}
        </div>
      )}
    </div>
  );
}
```

### Error Handling

Add comprehensive error handling:

```typescript
const handleSwapError = (error: any) => {
  switch (error.code) {
    case 'INSUFFICIENT_BALANCE':
      return 'Insufficient balance for swap';
    case 'SLIPPAGE_TOO_HIGH':
      return 'Price slippage too high, try lower amount';
    case 'NETWORK_ERROR':
      return 'Network error, please try again';
    case 'WALLET_REJECTED':
      return 'Transaction rejected by wallet';
    default:
      return 'Swap failed, please try again';
  }
};
```

## 4. Integration Points in EngiPay

### Payments & Swaps Page (`app/payments-swaps/page.tsx`)

```typescript
import { BtcSwap } from '@/components/payments/BtcSwap';
import { sendBitcoin, getBitcoinBalance } from '@/lib/xverse';

export default function PaymentsSwapsPage() {
  const [btcBalance, setBtcBalance] = useState(null);

  useEffect(() => {
    const loadBalance = async () => {
      const balance = await getBitcoinBalance();
      setBtcBalance(balance);
    };
    loadBalance();
  }, []);

  return (
    <div className="payments-swaps-page">
      <div className="btc-section">
        <h2>Bitcoin Operations</h2>
        <div className="btc-balance">
          Balance: {btcBalance ? (btcBalance.total / 100000000).toFixed(8) : '0'} BTC
        </div>
        {/* BTC Send/Receive forms */}
      </div>

      <div className="swap-section">
        <h2>Cross-Chain Swaps</h2>
        <BtcSwap />
      </div>
    </div>
  );
}
```

### Dashboard Integration (`components/dashboard/DashboardHeader.tsx`)

```typescript
import { getBitcoinBalance } from '@/lib/xverse';

export function DashboardHeader() {
  const [btcBalance, setBtcBalance] = useState(0);

  useEffect(() => {
    const loadBalances = async () => {
      // Load ETH, USDT, USDC balances (existing logic)
      const btcBal = await getBitcoinBalance();
      setBtcBalance(btcBal.total / 100000000);
    };
    loadBalances();
  }, []);

  return (
    <div className="dashboard-header">
      {/* Existing balances */}
      <div className="balance-item">
        <span>BTC:</span>
        <span>{btcBalance.toFixed(8)}</span>
      </div>
    </div>
  );
}
```

### Wallet Management Modal

Update `components/WalletConnectModal.tsx` to include Xverse connection status and BTC operations.

## 5. Styling and UX

Apply EngiPay's design system:

- Use glassmorphism effects for modals and cards
- Implement gradient backgrounds for swap buttons
- Add smooth animations for status transitions
- Ensure mobile-first responsive design
- Use consistent color scheme and typography

## 6. Testing and Deployment

### Testing Checklist

- [ ] Xverse wallet connection works
- [ ] BTC balance display accurate
- [ ] Send/receive BTC transactions complete
- [ ] Cross-chain swaps execute successfully
- [ ] Error handling covers all edge cases
- [ ] Mobile responsiveness verified
- [ ] API rate limits not exceeded

### Production Considerations

- Monitor API usage against trial limits
- Implement proper error logging
- Add transaction history persistence
- Consider upgrading to paid Xverse API plan
- Implement swap confirmation polling with proper timeouts

## Resources

- Xverse API Documentation: https://docs.xverse.app/api
- Atomiq SDK Documentation: https://docs.atomiq.fi
- EngiPay Design System: [internal docs]

## Support

For issues with Xverse API integration, contact Xverse support.
For Atomiq SDK questions, refer to their documentation or community forums.