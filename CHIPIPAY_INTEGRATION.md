# Chipi Pay Integration Guide for EngiPay

## Overview

Chipi Pay is a service purchasing platform that allows users to buy digital services using blockchain transactions through self-custodial wallets. This integration enables EngiPay users to purchase services directly within the app, enhancing the payments ecosystem.

**Key Features:**
- Service purchasing via blockchain transactions
- Self-custodial wallet integration
- Real-time purchase status updates
- Support for multiple service types (SKUs)

## Prerequisites

- Chipi Pay account and API keys (get from [dashboard.chipipay.com](https://dashboard.chipipay.com))
- Node.js 18+ for frontend development
- Backend framework (when implemented) for API proxying
- Wallet connection (already implemented in EngiPay via WalletContext)

---

## Frontend Integration (Current Implementation)

### 1. SDK Installation

Install the Chipi Pay SDK:

```bash
npm install @chipipay/sdk
# or
yarn add @chipipay/sdk
```

### 2. Environment Variables Setup

Add to `.env.local`:

```env
# Chipi Pay Configuration
NEXT_PUBLIC_CHIPIPAY_API_KEY=pk_prod_xxxxxx
```

**Note:** For security, only expose the public key in frontend. Secret keys should be handled server-side.

### 3. Chipi Pay Provider Setup

Create a new context/provider for Chipi Pay in `contexts/ChipiPayContext.tsx`:

```tsx
'use client'

import React, { createContext, useContext, ReactNode } from 'react'
import { ChipiPayProvider } from '@chipipay/sdk'

interface ChipiPayContextType {
  // Add any custom context values here
}

const ChipiPayContext = createContext<ChipiPayContextType | undefined>(undefined)

export function useChipiPay() {
  const context = useContext(ChipiPayContext)
  if (!context) {
    throw new Error('useChipiPay must be used within ChipiPayProvider')
  }
  return context
}

interface ChipiPayProviderProps {
  children: ReactNode
}

export function ChipiPayProviderWrapper({ children }: ChipiPayProviderProps) {
  return (
    <ChipiPayProvider
      apiKey={process.env.NEXT_PUBLIC_CHIPIPAY_API_KEY!}
      environment="production" // or "development"
    >
      <ChipiPayContext.Provider value={{}}>
        {children}
      </ChipiPayContext.Provider>
    </ChipiPayProvider>
  )
}
```

### 4. Wrap App with Provider

Update `app/layout.tsx` to include the Chipi Pay provider:

```tsx
import { ChipiPayProviderWrapper } from '@/contexts/ChipiPayContext'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <WalletProvider>
            <ChipiPayProviderWrapper>
              {children}
            </ChipiPayProviderWrapper>
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
```

### 5. Service Purchase Component

Create `components/payments/ServicePurchase.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useGetSKUs, useBuySKU } from '@chipipay/sdk'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader } from '@/components/ui/loader'

export function ServicePurchase() {
  const [selectedSKU, setSelectedSKU] = useState<string | null>(null)
  const { data: skus, isLoading: skusLoading } = useGetSKUs()
  const { mutate: buySKU, isLoading: buyLoading } = useBuySKU()

  const handlePurchase = async (skuId: string) => {
    try {
      await buySKU({
        skuId,
        // Additional parameters as needed
      })
      // Handle success
    } catch (error) {
      // Handle error
      console.error('Purchase failed:', error)
    }
  }

  if (skusLoading) return <Loader />

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Purchase Services</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skus?.map((sku) => (
          <Card key={sku.id}>
            <CardHeader>
              <CardTitle>{sku.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">{sku.description}</p>
              <p className="text-lg font-semibold mb-4">${sku.price}</p>
              <Button
                onClick={() => handlePurchase(sku.id)}
                disabled={buyLoading}
                className="w-full"
              >
                {buyLoading ? <Loader /> : 'Purchase'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

### 6. Integrate into Payments Page

Update `app/payments-swaps/page.tsx` to include the service purchase component:

```tsx
import { ServicePurchase } from '@/components/payments/ServicePurchase'

// Add to the page component
<ServicePurchase />
```

### 7. Error Handling and User Feedback

Implement proper error handling and toast notifications:

```tsx
import { useToast } from '@/hooks/use-toast'

export function ServicePurchase() {
  const { toast } = useToast()

  const handlePurchase = async (skuId: string) => {
    try {
      await buySKU({ skuId })
      toast({
        title: "Purchase Successful",
        description: "Your service purchase is being processed.",
      })
    } catch (error) {
      toast({
        title: "Purchase Failed",
        description: "Please try again or contact support.",
        variant: "destructive",
      })
    }
  }
}
```

---

## Backend Integration (Future Implementation)

### API Endpoints to Add

Add these endpoints to the backend API (see `BACKEND_API_DOCUMENTATION.md` for reference):

#### GET `/chipipay/skus`

Proxy the Chipi Pay Get SKUs endpoint.

**Implementation:**
```javascript
// Example Express.js route
app.get('/chipipay/skus', async (req, res) => {
  try {
    const response = await fetch('https://api.chipipay.com/v1/skus', {
      headers: {
        'Authorization': `Bearer ${process.env.CHIPIPAY_SECRET_KEY}`,
      },
    })
    const data = await response.json()
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch SKUs' })
  }
})
```

#### POST `/chipipay/buy`

Proxy the Chipi Pay Buy SKU endpoint.

**Request Body:**
```json
{
  "skuId": "string",
  "quantity": 1,
  "recipientAddress": "0x..."
}
```

**Implementation:**
```javascript
app.post('/chipipay/buy', async (req, res) => {
  try {
    const { skuId, quantity, recipientAddress } = req.body

    const response = await fetch('https://api.chipipay.com/v1/buy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CHIPIPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sku_id: skuId,
        quantity,
        recipient_address: recipientAddress,
      }),
    })

    const data = await response.json()
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: 'Purchase failed' })
  }
})
```

### Environment Variables (Backend)

Add to backend `.env`:

```env
CHIPIPAY_SECRET_KEY=sk_prod_xxxxxx
CHIPIPAY_WEBHOOK_SECRET=wh_sec_xxxxxx
```

### Webhook Handling

Implement webhook endpoint for purchase status updates:

#### POST `/webhooks/chipipay`

```javascript
app.post('/webhooks/chipipay', (req, res) => {
  const signature = req.headers['chipipay-signature']
  const payload = req.body

  // Verify webhook signature
  if (!verifyWebhookSignature(signature, payload)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  // Process webhook data
  const { transaction_id, status, user_id } = payload

  // Update database with transaction status
  // Send notifications to user
  // etc.

  res.json({ received: true })
})

function verifyWebhookSignature(signature, payload) {
  // Implement signature verification using CHIPIPAY_WEBHOOK_SECRET
  // Return true if valid, false otherwise
}
```

### Database Schema Additions

Add to the database schema:

```sql
-- Chipi Pay Transactions Table
CREATE TABLE chipipay_transactions (
  id SERIAL PRIMARY KEY,
  transaction_id VARCHAR(255) UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id),
  sku_id VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  status VARCHAR(50) NOT NULL,
  blockchain_tx_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chipi Pay Webhooks Table
CREATE TABLE chipipay_webhooks (
  id SERIAL PRIMARY KEY,
  webhook_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Testing

### Frontend Testing

1. Use development API keys for testing
2. Test with small amounts
3. Verify wallet connection before purchases
4. Test error scenarios (insufficient funds, network issues)

### Backend Testing

1. Test API endpoints with mock data
2. Verify webhook signature validation
3. Test database operations
4. Integration testing with Chipi Pay sandbox

### Development vs Production

- **Development:** Use sandbox environment and test keys
- **Production:** Use live environment and production keys

Set environment in provider:
```tsx
<ChipiPayProvider
  apiKey={process.env.NEXT_PUBLIC_CHIPIPAY_API_KEY!}
  environment={process.env.NODE_ENV === 'production' ? 'production' : 'development'}
/>
```

---

## Security Considerations

1. **API Keys:** Never expose secret keys in frontend code
2. **Webhook Verification:** Always verify webhook signatures
3. **Input Validation:** Validate all user inputs
4. **Rate Limiting:** Implement rate limiting on API endpoints
5. **Error Handling:** Don't expose sensitive error details to users

---

## Support and Resources

- **Documentation:** [Chipi Pay API Docs](https://docs.chipipay.com)
- **Dashboard:** [dashboard.chipipay.com](https://dashboard.chipipay.com)
- **Support:** support@chipipay.com
- **Community:** Telegram group (link in dashboard)

---

## Implementation Checklist

### Frontend
- [ ] Install Chipi Pay SDK
- [ ] Set up environment variables
- [ ] Create Chipi Pay context/provider
- [ ] Wrap app with provider
- [ ] Create service purchase component
- [ ] Integrate into payments page
- [ ] Add error handling and notifications
- [ ] Test with development keys

### Backend (Future)
- [ ] Add SKU fetching endpoint
- [ ] Add purchase endpoint
- [ ] Implement webhook handling
- [ ] Set up database tables
- [ ] Configure environment variables
- [ ] Test endpoints
- [ ] Deploy and monitor

---

*This guide is designed to be used by different developers working on frontend and backend components. The frontend can be implemented immediately, while backend requirements are documented for future development.*