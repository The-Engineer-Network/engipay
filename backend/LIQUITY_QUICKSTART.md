# Liquity Integration - Quick Start Guide

Get up and running with Liquity protocol integration in 5 minutes.

## Step 1: Install Dependencies

```bash
cd backend
npm install @liquity/lib-ethers
```

## Step 2: Configure Environment

Add to `backend/.env`:

```env
# Ethereum Configuration
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
ETHEREUM_PRIVATE_KEY=0x...

# Liquity Configuration
LIQUITY_NETWORK=mainnet
LIQUITY_AUTO_TOPUP=false
LIQUITY_ALERTS_ENABLED=true
```

**Important:** 
- Use testnet (goerli/sepolia) for testing first
- Never commit your private key
- Get a free RPC URL from [Alchemy](https://www.alchemy.com/) or [Infura](https://infura.io/)

## Step 3: Sync Database

```bash
npm run sync-db
```

This creates the Liquity tables:
- `liquity_troves`
- `liquity_transactions`
- `liquity_stability_deposits`

## Step 4: Test Connection

```bash
npm run test-liquity
```

Expected output:
```
 Service initialized
 ETH Price: $2,500.00
 Total Collateral Ratio: 250.00%
 All tests passed!
```

## Step 5: Start Server

```bash
npm run dev
```

The Liquity routes are now available at `/api/liquity/*`

## Quick API Test

### Get ETH Price
```bash
curl http://localhost:5000/api/liquity/price
```

### Get Service Status
```bash
curl http://localhost:5000/api/liquity/status
```

### Open a Trove (requires auth token)
```bash
curl -X POST http://localhost:5000/api/liquity/trove/open \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "depositCollateral": 5.0,
    "borrowLUSD": 5000,
    "maxBorrowingRate": 0.05
  }'
```

## Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/liquity/status` | GET | Service status |
| `/api/liquity/price` | GET | Current ETH price |
| `/api/liquity/tcr` | GET | Total Collateral Ratio |
| `/api/liquity/trove/open` | POST | Open new Trove |
| `/api/liquity/trove/:id/close` | POST | Close Trove |
| `/api/liquity/trove/:id/adjust` | POST | Adjust Trove |
| `/api/liquity/trove/:id` | GET | Get Trove details |
| `/api/liquity/troves` | GET | List user Troves |
| `/api/liquity/stability/deposit` | POST | Deposit to pool |
| `/api/liquity/stability/withdraw` | POST | Withdraw from pool |
| `/api/liquity/transactions` | GET | Transaction history |

## Monitoring

The Liquity monitor starts automatically with the server and:
- Checks all active Troves every 60 seconds
- Calculates health scores and risk levels
- Sends alerts for low collateral ratios
- Can auto top-up if enabled

Test the monitor:
```bash
npm run test-liquity-monitor
```

## Usage Examples

Run example scripts:
```bash
npm run liquity-examples
```

## Key Concepts

### Collateral Ratio
```
CR = (ETH Collateral × ETH Price) / LUSD Debt × 100
```

### Minimum Requirements
- **Min CR:** 110% (liquidation threshold)
- **Min Debt:** 2,000 LUSD
- **Liquidation Reserve:** 200 LUSD (returned when closed)
- **Borrowing Fee:** 0.5% - 5% (one-time)

### Risk Levels
- **Safe:** CR ≥ 150%
- **Moderate:** CR 130-150%
- **Warning:** CR 120-130%
- **Critical:** CR 115-120%
- **Liquidation:** CR < 115%

## Safety Tips

1. **Start Conservative:** Use 200%+ collateral ratio
2. **Test on Testnet:** Always test before mainnet
3. **Monitor Regularly:** Enable alerts and webhooks
4. **Keep Buffer:** Maintain CR well above 110%
5. **Have Backup:** Keep extra ETH for emergencies

## Troubleshooting

### "Service not initialized"
- Check `ETHEREUM_RPC_URL` is set
- Verify `ETHEREUM_PRIVATE_KEY` is configured
- Ensure RPC endpoint is accessible

### "Minimum debt is 2000 LUSD"
- Borrow at least 2,000 LUSD when opening Trove

### "Collateral ratio below minimum"
- Increase collateral or reduce borrow amount
- Minimum CR is 110%

### "Transaction failed"
- Check wallet has sufficient ETH for gas
- Verify gas price settings
- Ensure operation parameters are valid

## Next Steps

1. Read full documentation: `README_LIQUITY_INTEGRATION.md`
2. Review examples: `examples/liquity-usage-example.js`
3. Configure monitoring alerts
4. Set up webhooks for notifications
5. Test all operations on testnet
6. Deploy to production

## Resources

- **Liquity Docs:** https://docs.liquity.org/
- **SDK Docs:** https://github.com/liquity/dev/tree/main/docs/sdk
- **GitHub:** https://github.com/liquity/dev
- **Discord:** Available through official website

## Support

For issues:
1. Check this guide
2. Review error messages
3. Test on testnet
4. Check Liquity Discord
5. Review GitHub issues

---

**Ready to go!** 🚀

Start with small amounts on testnet, then scale up on mainnet.
