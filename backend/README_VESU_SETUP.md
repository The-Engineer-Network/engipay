# Vesu V2 Lending Integration - Setup Guide

This guide covers the initial setup for the Vesu V2 lending protocol integration.

## Prerequisites

- Node.js v16 or higher
- npm or yarn package manager
- Starknet wallet (ArgentX or Braavos)
- Access to Starknet Sepolia testnet

## Installation

All required dependencies have been installed:

### Core Dependencies
- `starknet@^6.0.0` - Starknet blockchain interaction library
- `@starknet-io/types-js` - TypeScript types for Starknet
- `decimal.js` - Precise decimal arithmetic for financial calculations

### Testing Dependencies
- `fast-check@^3.15.0` - Property-based testing framework
- `jest` - Unit and integration testing
- `supertest` - API endpoint testing

## Configuration Files

### 1. Starknet Provider Configuration
**Location**: `backend/config/starknet.js`

Handles RPC provider connection and network configuration.

**Key Functions**:
- `getStarknetProvider()` - Initialize Starknet RPC provider
- `getChainId()` - Get network chain ID
- `validateConnection()` - Test RPC connection

### 2. Vesu Protocol Configuration
**Location**: `backend/config/vesu.config.js`

Contains pool addresses, parameters, and protocol settings.

**Key Features**:
- Separate configurations for Sepolia testnet and mainnet
- Pool parameters (LTV, liquidation thresholds, bonuses)
- Asset configurations (decimals, symbols)
- Monitoring and transaction settings

**Key Functions**:
- `getVesuConfig()` - Get configuration for current network
- `getPoolConfig(poolKey)` - Get specific pool configuration
- `getActivePools()` - Get all active lending pools
- `getAssetConfig(symbol)` - Get asset configuration

### 3. Environment Variables
**Location**: `backend/.env.example`

Template for required environment variables.

**Required Variables**:
```bash
# Starknet Configuration
STARKNET_NETWORK=sepolia
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...

# Vesu Configuration
VESU_ORACLE_ADDRESS=0x...
```

## Setup Steps

### 1. Create Environment File

```bash
cd backend
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` and fill in the required values:

```bash
# For testnet development
STARKNET_NETWORK=sepolia
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io

# Your Starknet account details
STARKNET_ACCOUNT_ADDRESS=0x... # Your account address
STARKNET_PRIVATE_KEY=0x...     # Your private key (keep secure!)

# Oracle address (will be updated in Task 2)
VESU_ORACLE_ADDRESS=0x...
```

### 3. Test Configuration

Test that the Vesu configuration loads correctly:

```bash
npm run test-vesu-config
```

Expected output:
```
=== Vesu Configuration Test ===

Network: sepolia
Oracle Address: 0x...
Monitoring Interval: 60000ms

Active Pools:
  - ETH-USDC: ...
  - STRK-USDC: ...

✓ Configuration loaded successfully
```

### 4. Test Starknet Connection

Test RPC provider connection (requires valid RPC URL in .env):

```bash
npm run test-starknet
```

Expected output:
```
=== Starknet Connection Test ===

Initializing Starknet provider...
Chain ID: ...

Testing connection...
Successfully connected to Starknet. Current block: ...

Network Information:
  Block Number: ...
  Block Hash: ...
  Timestamp: ...

✓ Connection test successful
```

## Available NPM Scripts

```bash
# Test Vesu configuration
npm run test-vesu-config

# Test Starknet RPC connection
npm run test-starknet

# Run all tests
npm test

# Start development server
npm run dev

# Start production server
npm start
```

## Directory Structure

```
backend/
├── config/
│   ├── starknet.js              # Starknet provider configuration
│   ├── vesu.config.js           # Vesu protocol configuration
│   ├── README_VESU_ENV.md       # Environment setup guide
│   └── database.js              # Database configuration
├── scripts/
│   ├── test-starknet-connection.js  # Connection test script
│   └── test-vesu-config.js          # Configuration test script
├── .env.example                 # Environment template
└── package.json                 # Dependencies and scripts
```

## Next Steps

After completing the environment setup:

1. **Task 2**: Research & Documentation Review
   - Review Vesu V2 developer documentation
   - Examine Pool contract interfaces and ABIs
   - Update pool addresses in `vesu.config.js`

2. **Task 3**: Database Schema Implementation
   - Create Sequelize models for Vesu positions
   - Set up database migrations

3. **Task 4**: Starknet Integration Layer
   - Implement contract manager
   - Implement transaction manager

## Troubleshooting

### Configuration Issues

**Problem**: Configuration test fails
- Verify `vesu.config.js` syntax is correct
- Check environment variables are set
- Ensure network selection is valid

### Connection Issues

**Problem**: Starknet connection test fails
- Verify `STARKNET_RPC_URL` is set in `.env`
- Check RPC endpoint is accessible
- Ensure network selection matches RPC endpoint
- Try alternative RPC providers:
  - `https://starknet-sepolia.public.blastapi.io`
  - `https://free-rpc.nethermind.io/sepolia-juno`

### Dependency Issues

**Problem**: npm install fails
- Clear npm cache: `npm cache clean --force`
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again
- Check Node.js version: `node --version` (should be v16+)

## Security Notes

- **Never commit `.env` file** - it contains sensitive keys
- **Use different keys** for testnet and mainnet
- **Rotate keys regularly** in production
- **Monitor account activity** for unusual transactions
- **Use key management systems** (AWS KMS, Vault) for production

## Resources

- **Vesu Documentation**: https://docs.vesu.xyz/
- **Starknet Documentation**: https://docs.starknet.io/
- **Starknet.js Documentation**: https://www.starknetjs.com/
- **Sepolia Explorer**: https://sepolia.starkscan.co/
- **Testnet Faucet**: https://faucet.goerli.starknet.io/

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Vesu documentation
3. Check Starknet.js documentation
4. Contact the development team

---

**Status**: ✓ Environment Setup Complete (Task 1)

**Next Task**: Research & Documentation Review (Task 2)
