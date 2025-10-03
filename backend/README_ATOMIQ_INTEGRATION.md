# Atomiq SDK Backend Integration

This document describes the Atomiq SDK integration implemented in the EngiPay backend.

## Overview

The backend now supports comprehensive Atomiq SDK integration for cross-chain swap operations, including transaction tracking, webhook processing, and quote management.

## New Features

### 1. Database Models

- **Swap Model** (`models/Swap.js`): Stores swap transaction data
- **SwapQuote Model** (`models/SwapQuote.js`): Caches swap quotes for better performance

### 2. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/swap/quotes` | Get swap quotes with caching |
| POST | `/api/swap/initiate` | Initiate a new swap |
| GET | `/api/swap/history` | Get user's swap history |
| GET | `/api/swap/:id` | Get specific swap details |
| PUT | `/api/swap/:id/status` | Update swap status (internal) |
| POST | `/api/webhooks/atomiq/swaps` | Atomiq webhook handler |

### 3. Services

- **AtomiqService** (`services/atomiqService.js`): Handles Atomiq API interactions and validation

### 4. Middleware

- **Rate Limiting** (`middleware/rateLimit.js`): Prevents abuse with specific limits for quotes and swaps
- **Validation** (`middleware/validation.js`): Input validation using Joi schemas

## Setup Instructions

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:
- `MONGODB_URI`: MongoDB connection string
- `ATOMIQ_API_URL`: Atomiq API base URL
- `ATOMIQ_API_KEY`: Your Atomiq API key
- `ATOMIQ_WEBHOOK_SECRET`: Webhook signature secret

### 3. Start the Server

```bash
npm run dev
```

## API Usage Examples

### Get Swap Quote

```bash
curl -X GET "http://localhost:3001/api/swap/quotes?fromToken=BTC&toToken=ETH&amount=0.1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Initiate Swap

```bash
curl -X POST "http://localhost:3001/api/swap/initiate" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromToken": "BTC",
    "toToken": "ETH",
    "amount": 0.1,
    "expectedOutput": 2.45,
    "txHash": "0x...",
    "atomiqSwapId": "atomiq_swap_123",
    "walletAddress": "bc1q..."
  }'
```

### Webhook Handling

The backend automatically processes Atomiq webhooks at `/api/webhooks/atomiq/swaps`. Make sure to configure the webhook URL in your Atomiq dashboard.

## Testing

Run the test suite:

```bash
npm test
```

## Security Features

- **Rate Limiting**: Prevents spam and abuse
- **Input Validation**: Comprehensive validation using Joi
- **Webhook Signature Verification**: Ensures webhook authenticity
- **JWT Authentication**: Secures all endpoints

## Monitoring

The integration includes comprehensive logging for:
- Swap operations
- Webhook processing
- API errors
- Rate limiting events

## Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**: Check `MONGODB_URI` in environment variables
2. **Atomiq API Errors**: Verify `ATOMIQ_API_KEY` and `ATOMIQ_API_URL`
3. **Webhook Signature Verification Failed**: Ensure `ATOMIQ_WEBHOOK_SECRET` matches your Atomiq dashboard

### Debug Mode

Set `NODE_ENV=development` for detailed logging.

## Support

For Atomiq-specific issues, refer to:
- Atomiq SDK Documentation: https://docs.atomiq.fi
- Atomiq Support Team

For EngiPay backend issues, check the application logs and ensure all environment variables are properly configured.