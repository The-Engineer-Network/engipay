# EngiPay Backend API

This is the backend API server for the EngiPay Web3 payments and DeFi super app.

## Features

- **Wallet Authentication**: Secure authentication using signed messages
- **Portfolio Management**: Real-time portfolio tracking and analytics
- **Transaction Processing**: Send, receive, and track transactions
- **DeFi Operations**: Lending, borrowing, staking, and yield farming
- **Token Swaps**: Cross-chain token exchange functionality
- **Payment Services**: P2P payments and merchant integrations
- **Chipi Pay Integration**: Service purchasing via blockchain transactions
- **Analytics**: Portfolio performance and DeFi analytics

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Authentication**: JWT with wallet signatures
- **Validation**: Express Validator
- **Security**: Helmet, CORS, Rate Limiting
- **Database**: PostgreSQL with Sequelize (planned)
- **Caching**: Redis (planned)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- PostgreSQL (for production database)

### Installation

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3001`

### Environment Variables

Create a `.env` file with the following variables:

```env
# Server Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Chipi Pay Configuration
CHIPIPAY_SECRET_KEY=your-chipipay-secret-key

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/engipay

# Redis Configuration
REDIS_URL=redis://localhost:6379
```

## API Endpoints

### Authentication
- `POST /api/auth/nonce` - Generate authentication nonce
- `POST /api/auth/verify` - Verify signed message and get JWT
- `POST /api/auth/refresh` - Refresh JWT token

### User Management
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile
- `PUT /api/users/settings` - Update user settings

### Portfolio
- `GET /api/portfolio/balances` - Get portfolio balances
- `GET /api/portfolio/history` - Get portfolio history
- `GET /api/portfolio/performance` - Get portfolio performance

### Transactions
- `GET /api/transactions` - Get transaction history
- `GET /api/transactions/:id` - Get transaction details
- `POST /api/transactions/send` - Send transaction

### DeFi Operations
- `GET /api/defi/portfolio` - Get DeFi portfolio
- `GET /api/defi/opportunities` - Get DeFi opportunities
- `POST /api/defi/lend` - Lend assets
- `POST /api/defi/borrow` - Borrow assets
- `POST /api/defi/stake` - Stake assets
- `GET /api/defi/rewards` - Get rewards
- `POST /api/defi/claim-rewards` - Claim rewards

### Swaps
- `GET /api/swap/quote` - Get swap quote
- `POST /api/swap` - Execute swap

### Payments
- `POST /api/payments/send` - Send payment
- `GET /api/payments/requests` - Get payment requests
- `POST /api/payments/request` - Create payment request

### Chipi Pay Integration
- `GET /api/chipipay/skus` - Get available services
- `POST /api/chipipay/buy` - Purchase service
- `POST /api/chipipay/webhooks` - Handle Chipi Pay webhooks

### Analytics
- `GET /api/analytics/portfolio` - Portfolio analytics
- `GET /api/analytics/defi` - DeFi analytics

### Webhooks
- `POST /api/webhooks/transaction-update` - Transaction updates
- `POST /api/webhooks/price-update` - Price updates

## Development

### Available Scripts

- `npm run dev` - Start development server with nodemon
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Run ESLint

### Project Structure

```
backend/
├── routes/           # API route handlers
│   ├── auth.js      # Authentication routes
│   ├── users.js     # User management routes
│   ├── portfolio.js # Portfolio routes
│   ├── transactions.js # Transaction routes
│   ├── defi.js      # DeFi operation routes
│   ├── swaps.js     # Token swap routes
│   ├── payments.js  # Payment routes
│   ├── chipipay.js  # Chipi Pay integration routes
│   ├── analytics.js # Analytics routes
│   └── webhooks.js  # Webhook handlers
├── middleware/       # Express middleware
│   └── auth.js      # Authentication middleware
├── models/          # Database models (planned)
├── utils/           # Utility functions
├── config/          # Configuration files
├── server.js        # Main server file
├── package.json     # Dependencies
├── .env             # Environment variables
└── README.md        # This file
```

## Security

- JWT-based authentication with wallet signatures
- Rate limiting on all endpoints
- Input validation and sanitization
- CORS configuration
- Helmet security headers
- Secure webhook signature verification

## Testing

Run the test suite:

```bash
npm test
```

## Deployment

### Environment Setup

1. Set `NODE_ENV=production`
2. Configure production database
3. Set up Redis for caching
4. Configure webhook endpoints
5. Set secure JWT secret

### Docker Deployment (Recommended)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

## Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Use meaningful commit messages

## License

MIT License - see LICENSE file for details.


## Liquity Protocol Integration

EngiPay now supports Liquity V1 protocol for interest-free borrowing against ETH collateral.

### Features

- **Trove Management**: Open, close, and adjust borrowing positions
- **Stability Pool**: Deposit LUSD to earn liquidation gains and LQTY rewards
- **Automated Monitoring**: Real-time health checks and liquidation alerts
- **Risk Management**: Collateral ratio tracking and auto top-up
- **Complete API**: RESTful endpoints for all Liquity operations

### Quick Start

1. **Install Liquity SDK:**
   ```bash
   npm install @liquity/lib-ethers
   ```

2. **Configure Environment:**
   ```env
   ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   ETHEREUM_PRIVATE_KEY=0x...
   LIQUITY_NETWORK=mainnet
   ```

3. **Setup and Test:**
   ```bash
   npm run setup-liquity    # Automated setup
   npm run sync-db          # Create database tables
   npm run test-liquity     # Test connection
   ```

4. **Start Server:**
   ```bash
   npm run dev
   ```

### API Endpoints

All Liquity endpoints are available at `/api/liquity/*`:

- `GET /api/liquity/status` - Service status
- `GET /api/liquity/price` - Current ETH price
- `POST /api/liquity/trove/open` - Open new Trove
- `POST /api/liquity/trove/:id/adjust` - Adjust Trove
- `POST /api/liquity/stability/deposit` - Deposit to Stability Pool
- `GET /api/liquity/transactions` - Transaction history

### Documentation

- **Quick Start**: [LIQUITY_QUICKSTART.md](./LIQUITY_QUICKSTART.md)
- **Full Guide**: [README_LIQUITY_INTEGRATION.md](./README_LIQUITY_INTEGRATION.md)
- **Deployment**: [LIQUITY_DEPLOYMENT_CHECKLIST.md](./LIQUITY_DEPLOYMENT_CHECKLIST.md)
- **Examples**: [examples/liquity-usage-example.js](./examples/liquity-usage-example.js)

### NPM Scripts

```bash
npm run setup-liquity          # Automated setup
npm run test-liquity           # Test connection
npm run test-liquity-monitor   # Test monitoring
npm run liquity-examples       # Run usage examples
```

### Important Notes

 **Always test on testnet (Goerli/Sepolia) first!**

 **Minimum Requirements:**
- Minimum debt: 2,000 LUSD
- Minimum collateral ratio: 110%
- Recommended CR: 150-200%

 **Security:**
- Never commit private keys
- Use environment variables
- Enable monitoring alerts
- Maintain safe collateral ratios

For detailed information, see [README_LIQUITY_INTEGRATION.md](./README_LIQUITY_INTEGRATION.md)
