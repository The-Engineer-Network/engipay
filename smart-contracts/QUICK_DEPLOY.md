# Quick Deploy Reference

## One-Command Deployment

### Linux/Mac
```bash
cd smart-contracts && chmod +x scripts/deploy-all-contracts.sh && ./scripts/deploy-all-contracts.sh
```

### Windows
```cmd
cd smart-contracts && scripts\deploy-all-contracts.bat
```

## What Gets Deployed

| Contract | Purpose | Constructor Parameters |
|----------|---------|------------------------|
| **EngiToken** | ERC20 token | name, symbol, initial_supply, owner |
| **EscrowV2** | Payment escrow | owner, fee_recipient, platform_fee (250 = 2.5%) |
| **RewardDistributorV2** | Staking rewards | owner |
| **AtomiqAdapter** | BTC/STRK swaps | owner, fee_recipient, fee (100 = 1%), timeout (86400s) |
| **VesuAdapter** | Lending/borrowing | owner, vesu_protocol_address |

## File Structure

```
smart-contracts/
├── src/
│   ├── lib.cairo                    # Main library (all contracts)
│   ├── EngiToken.cairo              # ERC20 token
│   ├── EscrowV2.cairo               # Payment escrow
│   ├── RewardDistributorV2.cairo    # Staking system
│   ├── interfaces/
│   │   └── IERC20.cairo             # ERC20 interface
│   ├── libraries/
│   │   ├── SafeMath.cairo           # Math operations
│   │   ├── AccessControl.cairo      # Role management
│   │   └── ReentrancyGuard.cairo    # Security
│   └── adapters/
│       ├── AtomiqAdapter.cairo      # BTC swaps
│       └── VesuAdapter.cairo        # Lending
├── scripts/
│   ├── deploy-all-contracts.sh      # Linux/Mac deploy
│   └── deploy-all-contracts.bat     # Windows deploy
├── deployment-config.json           # Configuration
└── DEPLOYMENT_GUIDE.md              # Full guide
```

## Environment Setup

```bash
# 1. Install Scarb
curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh

# 2. Install Starkli
curl https://get.starkli.sh | sh && starkliup

# 3. Setup account
starkli account fetch <ADDRESS> --output ~/.starkli-wallets/account.json
starkli signer keystore from-key ~/.starkli-wallets/signer.json
```

## Manual Build & Deploy

```bash
# Build
cd smart-contracts
scarb build

# Deploy single contract
starkli deploy \
  target/dev/engipay_contracts_<ContractName>.contract_class.json \
  --network sepolia \
  --account ~/.starkli-wallets/account.json \
  <constructor_args>
```

## Post-Deployment

### Update .env
```env
ENGI_TOKEN_ADDRESS=0x...
ESCROW_CONTRACT_ADDRESS=0x...
REWARD_DISTRIBUTOR_ADDRESS=0x...
ATOMIQ_ADAPTER_ADDRESS=0x...
VESU_ADAPTER_ADDRESS=0x...
```

### Configure Contracts
```bash
# Add minter role
starkli invoke <ENGI_TOKEN> add_minter <REWARD_DISTRIBUTOR>

# Create reward pool
starkli invoke <REWARD_DISTRIBUTOR> create_pool <TOKEN> u256:1000000000000000000

# Add supported asset
starkli invoke <VESU_ADAPTER> add_supported_asset <TOKEN>
```

## Verification

```bash
# Check deployments
starkli call <ENGI_TOKEN> name
starkli call <ESCROW> get_platform_fee
starkli call <REWARD_DISTRIBUTOR> get_total_pools
```

## Networks

| Network | RPC | Explorer |
|---------|-----|----------|
| Sepolia | `https://starknet-sepolia.public.blastapi.io/rpc/v0_7` | `https://sepolia.starkscan.co` |
| Mainnet | `https://starknet-mainnet.public.blastapi.io/rpc/v0_7` | `https://starkscan.co` |

## Common Issues

| Issue | Solution |
|-------|----------|
| Build fails | `scarb clean && scarb build` |
| Insufficient funds | Get testnet ETH from faucet |
| Account not found | `starkli account fetch <ADDRESS>` |
| Wrong network | Set `NETWORK=sepolia` or `NETWORK=mainnet` |

## Contract Addresses (After Deployment)

Saved in `deployment-addresses.json`:
```json
{
  "network": "sepolia",
  "contracts": {
    "EngiToken": "0x...",
    "EscrowV2": "0x...",
    "RewardDistributorV2": "0x...",
    "AtomiqAdapter": "0x...",
    "VesuAdapter": "0x..."
  }
}
```

## Support

- Full guide: `DEPLOYMENT_GUIDE.md`
- Config: `deployment-config.json`
- Starknet docs: https://docs.starknet.io/
