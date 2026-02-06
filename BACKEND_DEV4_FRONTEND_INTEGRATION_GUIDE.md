# Backend Dev 4 - Frontend Integration Guide
## Quick Reference for Frontend Developers

**Last Updated**: February 1, 2026  
**Backend Dev**: Backend Dev 4 (Infrastructure)

---

## 🚀 Quick Start

All Backend Dev 4 APIs are ready for integration. Base URL: `http://localhost:3001/api`

### Authentication
Most endpoints require JWT token in header:
```javascript
headers: {
  'Authorization': 'Bearer YOUR_JWT_TOKEN'
}
```

---

## 💰 Price Feeds (CoinGecko)

### Get Current Prices
```javascript
// Single coin
GET /api/prices/current?coins=BTC&currencies=usd

// Multiple coins
GET /api/prices/current?coins=BTC,ETH,STRK&currencies=usd&includeMarketData=true

// Response
{
  "success": true,
  "data": {
    "bitcoin": {
      "usd": 45000,
      "usd_market_cap": 880000000000,
      "usd_24h_vol": 25000000000,
      "usd_24h_change": 2.5
    }
  },
  "timestamp": "2026-02-01T12:00:00Z"
}
```

### Get Historical Prices (for charts)
```javascript
GET /api/prices/historical/bitcoin?currency=usd&days=7

// Response
{
  "success": true,
  "data": {
    "prices": [
      [1706745600000, 44500],  // [timestamp, price]
      [1706832000000, 45000]
    ],
    "market_caps": [...],
    "total_volumes": [...]
  }
}
```

### Calculate Portfolio Value
```javascript
POST /api/prices/portfolio-value
{
  "holdings": [
    { "symbol": "BTC", "amount": 0.5 },
    { "symbol": "ETH", "amount": 10 },
    { "symbol": "STRK", "amount": 1000 }
  ],
  "currency": "usd"
}

// Response
{
  "success": true,
  "data": {
    "totalValue": 52345.67,
    "currency": "usd",
    "holdings": [
      {
        "symbol": "BTC",
        "amount": 0.5,
        "price": 45000,
        "value": 22500,
        "change24h": 2.5
      }
    ]
  }
}
```

### Search Coins
```javascript
GET /api/prices/search?query=stark

// Response
{
  "success": true,
  "data": {
    "coins": [
      {
        "id": "starknet",
        "name": "Starknet",
        "symbol": "STRK",
        "thumb": "https://..."
      }
    ]
  }
}
```

---

## 🔔 Notifications

### Send Email Notification
```javascript
POST /api/notifications/email
{
  "to": "user@example.com",
  "subject": "Transaction Confirmed",
  "htmlContent": "<h1>Your transaction is confirmed!</h1>",
  "textContent": "Your transaction is confirmed!"
}

// Response
{
  "success": true,
  "data": {
    "messageId": "abc123"
  }
}
```

### Register Webhook
```javascript
POST /api/notifications/webhooks
{
  "id": "webhook_1",
  "url": "https://your-app.com/webhook",
  "events": ["transaction.confirmed", "swap.completed"],
  "secret": "your_webhook_secret"
}

// Response
{
  "success": true,
  "data": {
    "webhookId": "webhook_1"
  }
}
```

### Send Transaction Notification
```javascript
POST /api/notifications/transaction
{
  "userId": "user_123",
  "transaction": {
    "type": "send",
    "status": "confirmed",
    "amount": 100,
    "currency": "STRK",
    "hash": "0x123...",
    "timestamp": "2026-02-01T12:00:00Z"
  },
  "userEmail": "user@example.com"
}

// Response
{
  "success": true,
  "data": {
    "success": true
  }
}
```

### Available Event Types
```javascript
GET /api/notifications/event-types

// Response
{
  "success": true,
  "data": {
    "TRANSACTION_CONFIRMED": "transaction.confirmed",
    "TRANSACTION_FAILED": "transaction.failed",
    "SWAP_COMPLETED": "swap.completed",
    "SWAP_FAILED": "swap.failed",
    "PRICE_ALERT": "price.alert",
    "DEPOSIT_RECEIVED": "deposit.received",
    "WITHDRAWAL_COMPLETED": "withdrawal.completed",
    "LENDING_POSITION_UPDATED": "lending.position.updated",
    "REWARD_CLAIMED": "reward.claimed",
    "SECURITY_ALERT": "security.alert"
  }
}
```

---

## 📊 Analytics

### Portfolio Analytics
```javascript
GET /api/analytics/portfolio?period=30d

// Response
{
  "success": true,
  "data": {
    "period": "30d",
    "total_value_usd": 5234.56,
    "total_return": 234.56,
    "total_return_percent": 4.69,
    "asset_allocation": [
      {
        "asset": "ETH",
        "percentage": 45.5,
        "value_usd": 2381.72
      }
    ],
    "performance_metrics": {
      "volatility": 0.15,
      "sharpe_ratio": 1.8,
      "max_drawdown": -5.2,
      "best_performer": {
        "asset": "STRK",
        "return_percent": 12.5
      }
    }
  }
}
```

### DeFi Analytics
```javascript
GET /api/analytics/defi

// Response
{
  "success": true,
  "data": {
    "total_value_locked": 4200.00,
    "total_rewards_earned": 150.00,
    "average_apy": 8.6,
    "protocols_used": ["Vesu", "Trove"],
    "active_positions": 3,
    "risk_distribution": {
      "low": 60,
      "medium": 30,
      "high": 10
    }
  }
}
```

### Transaction Analytics
```javascript
GET /api/analytics/transactions?period=30d

// Response
{
  "success": true,
  "data": {
    "period": "30d",
    "total_transactions": 45,
    "total_volume_usd": 12500.00,
    "average_transaction_size": 277.78,
    "total_fees_paid": 25.50,
    "transaction_types": {
      "send": 20,
      "receive": 15,
      "swap": 10
    },
    "success_rate": 97.8
  }
}
```

### Swap Analytics
```javascript
GET /api/analytics/swaps?period=30d

// Response
{
  "success": true,
  "data": {
    "period": "30d",
    "total_swaps": 15,
    "total_volume_usd": 5000.00,
    "average_swap_size": 333.33,
    "success_rate": 100.0,
    "popular_pairs": [
      {
        "from_asset": "ETH",
        "to_asset": "STRK",
        "count": 8,
        "volume_usd": 3200.00
      }
    ]
  }
}
```

### Rewards Analytics
```javascript
GET /api/analytics/rewards?period=30d

// Response
{
  "success": true,
  "data": {
    "period": "30d",
    "total_rewards_earned": 150.00,
    "total_rewards_usd": 180.50,
    "pending_rewards": 25.00,
    "rewards_by_protocol": [
      {
        "protocol": "Vesu",
        "amount": 85.50,
        "asset": "STRK",
        "value_usd": 102.60
      }
    ]
  }
}
```

---

## 🎨 React/Next.js Integration Examples

### Price Display Component
```typescript
// components/PriceDisplay.tsx
import { useEffect, useState } from 'react';

export function PriceDisplay({ coin }: { coin: string }) {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await fetch(
          `/api/prices/current?coins=${coin}&currencies=usd&includeMarketData=true`
        );
        const data = await response.json();
        
        if (data.success) {
          const coinId = coin.toLowerCase();
          setPrice(data.data[coinId]?.usd);
        }
      } catch (error) {
        console.error('Failed to fetch price:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [coin]);

  if (loading) return <div>Loading...</div>;
  if (!price) return <div>Price unavailable</div>;

  return (
    <div>
      <span className="text-2xl font-bold">${price.toLocaleString()}</span>
    </div>
  );
}
```

### Portfolio Analytics Hook
```typescript
// hooks/usePortfolioAnalytics.ts
import { useEffect, useState } from 'react';

interface PortfolioAnalytics {
  total_value_usd: number;
  total_return_percent: number;
  asset_allocation: Array<{
    asset: string;
    percentage: number;
    value_usd: number;
  }>;
}

export function usePortfolioAnalytics(period: string = '30d') {
  const [analytics, setAnalytics] = useState<PortfolioAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const token = localStorage.getItem('jwt_token');
        const response = await fetch(
          `/api/analytics/portfolio?period=${period}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );
        
        const data = await response.json();
        
        if (data.success) {
          setAnalytics(data.data);
        } else {
          setError('Failed to fetch analytics');
        }
      } catch (err) {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [period]);

  return { analytics, loading, error };
}
```

### Notification Sender
```typescript
// utils/notifications.ts
export async function sendTransactionNotification(
  transaction: {
    type: string;
    status: string;
    amount: number;
    currency: string;
    hash: string;
  },
  userEmail: string
) {
  const token = localStorage.getItem('jwt_token');
  
  try {
    const response = await fetch('/api/notifications/transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        userId: 'current_user_id', // Get from auth context
        transaction: {
          ...transaction,
          timestamp: new Date().toISOString()
        },
        userEmail
      })
    });

    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('Failed to send notification:', error);
    return false;
  }
}
```

---

## 🔄 Real-Time Updates

### Polling Strategy (Recommended for Now)
```typescript
// hooks/usePricePolling.ts
import { useEffect, useState } from 'react';

export function usePricePolling(coins: string[], interval: number = 60000) {
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchPrices = async () => {
      const response = await fetch(
        `/api/prices/current?coins=${coins.join(',')}&currencies=usd`
      );
      const data = await response.json();
      
      if (data.success) {
        const priceMap: Record<string, number> = {};
        Object.entries(data.data).forEach(([coinId, priceData]: [string, any]) => {
          priceMap[coinId] = priceData.usd;
        });
        setPrices(priceMap);
      }
    };

    fetchPrices();
    const timer = setInterval(fetchPrices, interval);

    return () => clearInterval(timer);
  }, [coins, interval]);

  return prices;
}
```

---

## ⚠️ Error Handling

### Standard Error Response
```javascript
{
  "success": false,
  "error": "Error message description"
}
```

### HTTP Status Codes
- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid token)
- `404` - Not Found
- `429` - Too Many Requests (rate limit)
- `500` - Internal Server Error

### Error Handling Example
```typescript
async function fetchWithErrorHandling(url: string, options?: RequestInit) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    // Show user-friendly error message
    throw error;
  }
}
```

---

## 🎯 Common Use Cases

### 1. Display Live Prices on Dashboard
```typescript
const prices = usePricePolling(['BTC', 'ETH', 'STRK'], 60000);
```

### 2. Show Portfolio Value
```typescript
const { analytics } = usePortfolioAnalytics('30d');
console.log(analytics?.total_value_usd);
```

### 3. Send Transaction Confirmation
```typescript
await sendTransactionNotification(transaction, user.email);
```

### 4. Display Analytics Charts
```typescript
const { data } = await fetch('/api/analytics/portfolio?period=30d');
// Use data.historical_values for chart
```

### 5. Search for Coins
```typescript
const results = await fetch('/api/prices/search?query=stark');
// Display search results
```

---

## 📝 Environment Variables

Add to your `.env.local`:
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

---

## 🐛 Debugging Tips

### Check API Status
```bash
curl http://localhost:3001/api/prices/current?coins=BTC&currencies=usd
```

### View Logs
Backend logs will show:
- API requests
- CoinGecko API calls
- Notification deliveries
- Errors and warnings

### Common Issues
1. **401 Unauthorized**: Check JWT token is valid
2. **429 Rate Limit**: Reduce API call frequency
3. **500 Server Error**: Check backend logs

---

## 📚 Additional Resources

- Full API Documentation: `BACKEND_API_DOCUMENTATION.md`
- Implementation Details: `backend/BACKEND_DEV4_VERIFICATION.md`
- Service Code: `backend/services/`
- Route Code: `backend/routes/`

---

## 🤝 Support

For questions or issues:
1. Check this guide first
2. Review API documentation
3. Check backend logs
4. Contact Backend Dev 4

---

**Happy Coding! 🚀**

*Last Updated: February 1, 2026*
