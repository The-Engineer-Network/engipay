# Deployment Fix Steps

## Issues Fixed:
1. ✅ Wallet authentication token not being saved to localStorage
2. ✅ Backend PostgreSQL SSL configuration for Render
3. ✅ Token cleanup on wallet disconnect

## What You Need to Do Now:

### 1. Commit and Push Changes
```bash
git add .
git commit -m "Fix wallet auth, database SSL, and balance display"
git push origin main
```

### 2. Render Backend Configuration

Go to Render Dashboard → `engipay-backend` service:

**Check Environment Variables:**
- `DATABASE_URL` - Should be auto-populated from database link
- `FRONTEND_URL` - Set to your Vercel URL (e.g., `https://your-app.vercel.app`)
- `JWT_SECRET` - Should be auto-generated
- `NODE_ENV` - Set to `production`
- `PORT` - Set to `3001`

**Important:** Make sure your database `engipay-db` is LINKED to the web service:
- In Render dashboard, go to your `engipay-backend` service
- Click "Environment" tab
- Scroll down to "Environment Variables from Database"
- Verify `engipay-db` is listed and connected

**Then:**
- Click "Manual Deploy" → "Deploy latest commit"
- Watch the logs - you should see: `✅ Connected to PostgreSQL database`

### 3. Vercel Frontend Configuration

Go to Vercel Dashboard → Your Project → Settings → Environment Variables:

**Add/Update these:**
- `NEXT_PUBLIC_BACKEND_URL` = `https://engipay-backend.onrender.com` (use your actual Render URL)
- `BACKEND_URL` = same as above

**Then:**
- Go to Deployments tab
- Click "Redeploy" on latest deployment

### 4. Clear Browser Cache

After both deployments complete:
1. Open your app in browser
2. Open DevTools (F12)
3. Go to Console tab
4. Run: `localStorage.clear(); location.reload();`

### 5. Test the Flow

1. **Connect Wallet:**
   - Click "Connect Wallet"
   - Choose your wallet (Argent/Braavos/MetaMask)
   - Approve connection

2. **Verify Token Saved:**
   - Open DevTools → Application → Local Storage
   - Check for `engipay-token` and `engipay-user`

3. **Check Balances:**
   - Dashboard should show your wallet balances
   - Balances come from WalletContext (fetched directly from blockchain)

4. **Test Transactions:**
   - Try viewing transaction history
   - Should not see "No authentication token" error

## Why Balances Show "No token balances found"

The dashboard gets balances from `WalletContext.balances`, which:
- Fetches directly from blockchain (StarkNet/Ethereum/Bitcoin)
- Doesn't require backend API
- Shows real-time on-chain balances

If you see "No token balances found":
1. Make sure wallet is connected
2. Check if you have any tokens in that wallet
3. The wallet might be empty or on wrong network

## ChipiPay Errors

ChipiPay errors happen because:
- Backend can't connect to database
- Once database connection is fixed, ChipiPay API will work

## Troubleshooting

### Backend Still Can't Connect to Database:

Check Render logs for:
```
🔄 Attempting to connect to PostgreSQL...
   Using DATABASE_URL
✅ Connected to PostgreSQL database
```

If you see connection refused:
1. Verify database is running in Render dashboard
2. Check database is in same region as web service (Oregon)
3. Verify DATABASE_URL environment variable is set
4. Try restarting the web service

### Frontend Still Shows "No authentication token":

1. Clear browser cache completely
2. Check Vercel deployment logs
3. Verify `NEXT_PUBLIC_BACKEND_URL` is set correctly
4. Try hard refresh (Ctrl+Shift+R)

### Balances Still Not Showing:

The balances are fetched from blockchain, not backend. Check:
1. Wallet is actually connected (check `isConnected` in console)
2. Wallet has tokens on the network you're connected to
3. Check browser console for any errors during balance fetch

## Quick Test Commands

**Check if backend is running:**
```bash
curl https://engipay-backend.onrender.com/health
```

Should return: `{"status":"OK","timestamp":"..."}`

**Check if token is saved (in browser console):**
```javascript
console.log(localStorage.getItem('engipay-token'));
console.log(localStorage.getItem('engipay-wallet'));
```

## Next Steps After Deployment

1. Monitor Render logs for any errors
2. Test all wallet connection flows
3. Test transaction history loading
4. Test ChipiPay purchases
5. Verify cross-chain swaps work
