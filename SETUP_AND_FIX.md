# Complete Setup and Fix Guide

## 🚨 Critical Issues Fixed

### 1. Database Table Missing ✅
- Created migration script to create "User" table
- Added proper indexes and constraints

### 2. Authentication Token Inconsistency ✅
- Fixed all components to use `engipay-token` consistently
- Updated 8+ files across payments and DeFi components

### 3. ChipiPay Implementation ✅
- Documented that ChipiPay is frontend-only
- Created implementation guide

## 📋 Setup Steps

### Step 1: Database Setup (CRITICAL - Do This First!)

Your PostgreSQL database is missing the User table. Run this command:

```bash
cd backend
node scripts/run-migrations.js
```

**Expected Output:**
```
🔄 Connecting to database...
✅ Database connected

📁 Found 2 migration files

🔄 Running migration: 000-create-users-table.sql
✅ Migration 000-create-users-table.sql completed successfully

🔄 Running migration: 001-create-new-models.sql
✅ Migration 001-create-new-models.sql completed successfully

✅ All migrations completed successfully
```

### Step 2: Verify Database Connection

```bash
cd backend
node scripts/test-starknet-connection.js
```

Should show database connection successful.

### Step 3: Restart Backend Server

```bash
cd backend
npm start
```

**Expected Output:**
```
✅ Connected to PostgreSQL database
✅ Database synchronized
EngiPay Backend server running on port 3001
```

### Step 4: Clear Browser Storage (IMPORTANT!)

Users who already tried to connect need to:

1. Open your app in browser
2. Press F12 (DevTools)
3. Go to "Application" tab
4. Click "Local Storage" → your domain
5. Delete all items (or just delete old `auth-token` if present)
6. Refresh page

### Step 5: Test Wallet Connection

1. Open app
2. Click "Connect Wallet"
3. Choose wallet (Argent/Braavos/MetaMask)
4. Approve connection
5. Check DevTools > Application > Local Storage
6. Verify these keys exist:
   - `engipay-wallet` ✅
   - `engipay-token` ✅
   - `engipay-user` ✅

### Step 6: Test Swap/Payments Page

1. After wallet connected
2. Navigate to "Payments & Swaps" page
3. Should NOT see "No authentication token" error
4. Transaction history should load (or show empty state)

## 🔧 What Was Fixed

### Files Created:
1. `backend/migrations/000-create-users-table.sql` - Creates User table
2. `backend/scripts/run-migrations.js` - Runs SQL migrations
3. `FIX_AUTHENTICATION_ISSUES.md` - Detailed fix documentation
4. `CHIPIPAY_IMPLEMENTATION_GUIDE.md` - ChipiPay usage guide
5. `SETUP_AND_FIX.md` - This file

### Files Modified:
1. `contexts/ChipiPayContext.tsx` - Fixed token key
2. `components/payments/PaymentModals.tsx` - Fixed token key
3. `components/payments/EscrowPayments.tsx` - Fixed token key
4. `components/payments/SendPayment.tsx` - Fixed token key
5. `components/defi/yield-farming.tsx` - Fixed token key
6. `components/defi/vesu-lending-integrated.tsx` - Fixed token key
7. `components/defi/trove-staking-integrated.tsx` - Fixed token key
8. `components/defi/portfolio-overview.tsx` - Fixed token key
9. `components/defi/defi-analytics.tsx` - Fixed token key

## 🌐 Deployment to Render.com

### Backend Environment Variables

Set these in Render Dashboard:

```env
# Database (Auto-provided by Render PostgreSQL)
DATABASE_URL=<from Render PostgreSQL service>

# JWT Secret (Generate a secure random string)
JWT_SECRET=<generate with: openssl rand -base64 32>

# Frontend URL
FRONTEND_URL=https://your-frontend-domain.vercel.app

# Node Environment
NODE_ENV=production

# Optional: Starknet RPC
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/YOUR_KEY
```

### Build Command (Render)
```bash
npm install && node scripts/run-migrations.js
```

This will:
1. Install dependencies
2. Run database migrations automatically
3. Create all required tables

### Start Command (Render)
```bash
node server.js
```

### Frontend Environment Variables (Vercel/Netlify)

```env
NEXT_PUBLIC_BACKEND_URL=https://your-backend.onrender.com
NEXT_PUBLIC_CHIPIPAY_API_KEY=pk_prod_15642cd599f907c1b4c204028dfdd1c0
```

## 🧪 Testing Checklist

### Test 1: Database ✅
```bash
cd backend
node scripts/run-migrations.js
```
Expected: All migrations complete successfully

### Test 2: Backend Health ✅
```bash
curl https://your-backend.onrender.com/health
```
Expected: `{"status":"OK","timestamp":"..."}`

### Test 3: Wallet Connect ✅
1. Open app
2. Connect wallet
3. Check DevTools console - no errors
4. Check Local Storage - `engipay-token` exists

### Test 4: API Calls ✅
1. After wallet connected
2. Go to Swap page
3. Try to get a quote
4. Should work without "No authentication token" error

### Test 5: Transaction History ✅
1. Navigate to Payments page
2. Transaction history loads
3. No authentication errors

## 🐛 Troubleshooting

### Error: "relation 'User' does not exist"
**Solution**: Run migrations
```bash
cd backend
node scripts/run-migrations.js
```

### Error: "No authentication token"
**Solution**: 
1. Clear browser local storage
2. Reconnect wallet
3. Verify `engipay-token` is stored

### Error: "Database connection failed"
**Solution**:
1. Check DATABASE_URL is set
2. Verify PostgreSQL is running
3. Check firewall allows connections
4. For Render: Ensure DB_SSL=true or use DATABASE_URL

### Error: "ChipiPay API unavailable"
**Status**: This is expected behavior
**Explanation**: ChipiPay is frontend-only, backend returns demo data
**Action**: See CHIPIPAY_IMPLEMENTATION_GUIDE.md for proper implementation

### Wallet connects but token not saved
**Solution**:
1. Check browser console for errors
2. Verify `/api/auth/wallet-connect` endpoint works
3. Test with: 
```bash
curl -X POST https://your-backend.onrender.com/api/auth/wallet-connect \
  -H "Content-Type: application/json" \
  -d '{"wallet_address":"0x123...","wallet_type":"argent"}'
```

## 📊 Database Schema

The User table includes:
- `id` (UUID, primary key)
- `wallet_address` (unique, indexed)
- `wallet_type` (metamask, argent, braavos, xverse, walletconnect)
- `email`, `username` (optional, unique)
- `kyc_status`, `is_active`, `is_email_verified`
- `settings` (JSONB for user preferences)
- `referral_code`, `referral_count`
- Timestamps: `created_at`, `updated_at`, `deleted_at`

## 🔐 Security Notes

1. **JWT Secret**: Use a strong random string (32+ characters)
2. **Database**: Always use SSL in production (DATABASE_URL includes SSL)
3. **CORS**: Backend only allows requests from FRONTEND_URL
4. **Rate Limiting**: Enabled on all API routes
5. **Token Storage**: Tokens stored in localStorage (consider httpOnly cookies for production)

## 📚 Additional Resources

- [FIX_AUTHENTICATION_ISSUES.md](./FIX_AUTHENTICATION_ISSUES.md) - Detailed technical fixes
- [CHIPIPAY_IMPLEMENTATION_GUIDE.md](./CHIPIPAY_IMPLEMENTATION_GUIDE.md) - ChipiPay integration
- [Render Deployment Docs](https://render.com/docs/deploy-node-express-app)
- [PostgreSQL on Render](https://render.com/docs/databases)

## ✅ Success Criteria

After following this guide, you should have:

1. ✅ Database with User table created
2. ✅ Backend running without errors
3. ✅ Wallet connection working
4. ✅ Authentication token stored correctly
5. ✅ Swap/Payments page loading without errors
6. ✅ Transaction history accessible
7. ✅ No "relation User does not exist" errors
8. ✅ No "No authentication token" errors

## 🆘 Still Having Issues?

If problems persist after following this guide:

1. Check backend logs in Render dashboard
2. Check browser console for frontend errors
3. Verify all environment variables are set
4. Test each endpoint individually with curl
5. Ensure PostgreSQL database is accessible
6. Try with a fresh browser session (incognito mode)

## 🎉 Next Steps

Once everything is working:

1. Test all features thoroughly
2. Implement proper ChipiPay SDK integration (see guide)
3. Add error tracking (Sentry, LogRocket)
4. Set up monitoring (Render metrics, Uptime Robot)
5. Configure backup strategy for database
6. Implement proper session management
7. Add comprehensive logging

---

**Last Updated**: March 5, 2026
**Status**: Ready for deployment
