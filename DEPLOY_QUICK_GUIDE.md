# ⚡ DEPLOY - Quick Guide

## 🚀 When You Get STRK Tokens

### 1️⃣ Deploy (2 minutes)
```bash
cd smart-contracts/scripts
node deploy-gasless.js
```

### 2️⃣ Copy Addresses (1 minute)
Script will output:
```
EngiToken:       0xABC123...
EscrowV2:        0xDEF456...
AtomiqAdapter:   0xGHI789...
```

### 3️⃣ Update Frontend (1 minute)
Edit `.env.local`:
```env
NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=0xABC123...
NEXT_PUBLIC_ESCROW_ADDRESS=0xDEF456...
NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=0xGHI789...
```

### 4️⃣ Update Backend (1 minute)
Edit `backend/.env`:
```env
ENGI_TOKEN_ADDRESS=0xABC123...
ESCROW_CONTRACT_ADDRESS=0xDEF456...
ATOMIQ_ADAPTER_ADDRESS=0xGHI789...
```

### 5️⃣ Restart (2 minutes)
```bash
# Terminal 1
cd backend
npm run dev

# Terminal 2 (from root)
npm run dev
```

### 6️⃣ Verify (3 minutes)
- Check backend logs: "✅ Escrow contract initialized"
- Open app: http://localhost:3000
- Test escrow payment
- **DONE!** 🎉

---

## ✅ CHECKLIST

Before deploying:
- [ ] Have STRK tokens
- [ ] Wallet address ready
- [ ] Private key ready

After deploying:
- [ ] Addresses copied
- [ ] `.env.local` updated
- [ ] `backend/.env` updated
- [ ] Backend restarted
- [ ] Frontend restarted
- [ ] Tested escrow payment

---

## 🎯 TOTAL TIME: 10 MINUTES

**That's it! You're done!** 🚀
