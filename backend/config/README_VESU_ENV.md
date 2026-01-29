# Vesu Integration Environment Setup

## Required Environment Variables

To use the Vesu V2 lending integration, you need to configure the following environment variables in your `.env` file:

### Starknet Network Configuration

```bash
# Network selection: 'sepolia' for testnet, 'mainnet' for production
STARKNET_NETWORK=sepolia

# RPC URL for Starknet network
# Sepolia testnet options:
# - https://starknet-sepolia.public.blastapi.io
# - https://free-rpc.nethermind.io/sepolia-juno
# - Your own RPC endpoint
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
```

### Starknet Account Configuration

```bash
# Backend account address (used for executing transactions)
# This should be a Starknet account contract address
STARKNET_ACCOUNT_ADDRESS=0x...

# Private key for the backend account
# IMPORTANT: Keep this secure! Never commit to version control
STARKNET_PRIVATE_KEY=0x...
```

### Vesu Protocol Configuration

```bash
# Pragma Oracle contract address
# Sepolia: TBD (to be added after research phase)
# Mainnet: TBD
VESU_ORACLE_ADDRESS=0x...
```

## Setup Instructions

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in the required values:
   - For testnet development, use Sepolia network
   - Create a Starknet account using ArgentX or Braavos wallet
   - Export your private key (keep it secure!)
   - Get testnet tokens from Starknet faucet

3. Verify connection:
   ```bash
   npm run test-starknet-connection
   ```

## Security Best Practices

- **Never commit `.env` file** - it's already in `.gitignore`
- **Use different keys** for testnet and mainnet
- **Rotate keys regularly** in production
- **Use key management systems** (AWS KMS, HashiCorp Vault) for production
- **Limit account permissions** - only grant necessary permissions
- **Monitor account activity** - set up alerts for unusual transactions

## Testnet Resources

- **Starknet Sepolia Faucet**: https://faucet.goerli.starknet.io/
- **Starknet Explorer**: https://sepolia.starkscan.co/
- **Vesu Documentation**: https://docs.vesu.xyz/

## Troubleshooting

### Connection Issues
- Verify RPC URL is accessible
- Check network selection matches RPC endpoint
- Ensure firewall allows outbound connections

### Authentication Issues
- Verify account address format (should start with 0x)
- Ensure private key is correct
- Check account has been deployed on-chain

### Transaction Failures
- Ensure account has sufficient balance for gas
- Verify account nonce is correct
- Check transaction parameters are valid
