# EngiPay Deployment Scripts

## 🚀 Gasless Deployment (RECOMMENDED)

Deploy contracts WITHOUT needing gas tokens using AVNU Paymaster!

### Windows:
```bash
cd smart-contracts/scripts
deploy-gasless.bat
```

### Linux/Mac:
```bash
cd smart-contracts/scripts
node deploy-gasless.js
```

### What You Need:
- Your Starknet wallet private key
- Your Starknet wallet address
- That's it! No gas tokens needed!

## 📚 Full Documentation

See [STARKZAP_DEPLOYMENT_GUIDE.md](../../STARKZAP_DEPLOYMENT_GUIDE.md) for complete instructions.

## 🔧 Traditional Deployment (Requires Gas)

If you prefer the traditional method with starkli:

```bash
./deploy-all.sh
```

**Note:** This requires ETH/STRK for gas fees.

## ✅ Which Method Should I Use?

| Method | Gas Needed? | Best For |
|--------|-------------|----------|
| **deploy-gasless.js** | ❌ No | Hackathons, testing, no tokens |
| deploy-all.sh | ✅ Yes | Production, full control |

## 🎯 Quick Start

1. Make sure contracts are compiled:
   ```bash
   cd smart-contracts
   scarb build
   ```

2. Run gasless deployment:
   ```bash
   cd scripts
   node deploy-gasless.js
   ```

3. Follow the prompts!

## 📝 After Deployment

The script will output environment variables. Copy them to:
- Frontend: `.env.local`
- Backend: `backend/.env`

## 🆘 Need Help?

Check the [STARKZAP_DEPLOYMENT_GUIDE.md](../../STARKZAP_DEPLOYMENT_GUIDE.md) for troubleshooting.
