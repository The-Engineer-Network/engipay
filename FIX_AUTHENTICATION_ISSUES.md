# Fix Authentication & Database Issues

## Issues Found

### 1. Database Table Missing ❌
**Error**: `relation "User" does not exist`

**Cause**: PostgreSQL database doesn't have the User table created

**Solution**: Run database migrations

### 2. Authentication Token Inconsistency ❌
**Error**: `No authentication token`

**Cause**: Frontend uses inconsistent token storage keys:
- Wallet login stores: `engipay-token`
- Some components read: `auth-token`
- Other components read: `token`

**Solution**: Standardize to `engipay-token` everywhere

### 3. ChipiPay API Unavailable ⚠️
**Error**: `ChipiPay API unavailable, returning demo SKUs`

**Cause**: ChipiPay is a frontend-only SDK, backend shouldn't call their API

**Solution**: Use ChipiPay SDK directly in frontend (see CHIPIPAY_IMPLEMENTATION_GUIDE.md)

## Fix Steps

### Step 1: Fix Database (CRITICAL)

Run the migration script to create the User table:

```bash
cd backend
node scripts/run-migrations.js
```

This will:
- Create the "User" table with proper schema
- Create indexes for performance
- Set up all required columns

### Step 2: Fix Token Storage (CRITICAL)

The wallet authentication already stores the token correctly as `engipay-token`.
We need to update components that read the wrong key.

**Files that need updating:**
- ✅ `contexts/WalletContext.tsx` - Already correct (stores `engipay-token`)
- ❌ `components/payments/EscrowPayments.tsx` - Uses `auth-token`
- ❌ `components/payments/SendPayment.tsx` - Uses `auth-token`
- ❌ `components/payments/PaymentModals.tsx` - Uses `auth-token`
- ❌ `components/defi/*.tsx` - Uses `token`

**Standard**: Always use `localStorage.getItem('engipay-token')`

### Step 3: Verify Wallet Authentication Flow

The wallet connect flow is correct:

```typescript
// In WalletContext.tsx (already working)
const response = await fetch('/api/auth/wallet-connect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    wallet_address: address,
    wallet_type: walletName.toLowerCase()
  })
});

if (response.ok) {
  const data = await response.json();
  if (data.token) {
    localStorage.setItem('engipay-token', data.token);  // ✅ Correct
    localStorage.setItem('engipay-user', JSON.stringify(data.user));
  }
}
```

### Step 4: Update All Components

Replace all instances of:
- `localStorage.getItem('auth-token')` → `localStorage.getItem('engipay-token')`
- `localStorage.getItem('token')` → `localStorage.getItem('engipay-token')`

## Quick Fix Commands

### 1. Run Database Migrations
```bash
cd backend
node scripts/run-migrations.js
```

### 2. Restart Backend Server
```bash
cd backend
npm start
```

### 3. Clear Browser Storage (Important!)
Users need to:
1. Open DevTools (F12)
2. Go to Application > Local Storage
3. Clear all old tokens
4. Reconnect wallet

## Testing the Fix

### Test 1: Database Connection
```bash
cd backend
node scripts/test-starknet-connection.js
```

Should show: ✅ Database connection successful

### Test 2: Wallet Authentication
1. Open app in browser
2. Connect wallet (Argent/Braavos/MetaMask)
3. Check DevTools > Application > Local Storage
4. Verify `engipay-token` exists
5. Navigate to Swap/Payments page
6. Should NOT see "No authentication token" error

### Test 3: Transaction History
1. After wallet connected
2. Go to Payments & Swaps page
3. Transaction history should load
4. No "No authentication token" error

## Environment Variables Checklist

### Backend (.env)
```env
# Database (REQUIRED)
DATABASE_URL=postgresql://user:password@host:5432/database
# OR
DB_NAME=engipay_db
DB_USER=engipay_user
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
DB_SSL=true  # Set to true for Render

# JWT (REQUIRED)
JWT_SECRET=your_jwt_secret_key_here

# ChipiPay (OPTIONAL - Backend doesn't need these)
# CHIPIPAY_SECRET_KEY=...  # Not needed
# CHIPIPAY_API_URL=...  # Not needed
```

### Frontend (.env.local)
```env
# Backend API
NEXT_PUBLIC_BACKEND_URL=https://your-backend.onrender.com

# ChipiPay (REQUIRED for ChipiPay features)
NEXT_PUBLIC_CHIPIPAY_API_KEY=pk_prod_15642cd599f907c1b4c204028dfdd1c0
```

## Common Errors & Solutions

### Error: "relation 'User' does not exist"
**Solution**: Run migrations (Step 1)

### Error: "No authentication token"
**Solution**: 
1. Clear browser local storage
2. Reconnect wallet
3. Verify token is stored as `engipay-token`

### Error: "ChipiPay API unavailable"
**Solution**: This is expected - ChipiPay should be used from frontend only

### Error: "Database connection failed"
**Solution**: 
1. Check DATABASE_URL is set correctly
2. Verify PostgreSQL is running
3. Check firewall/security groups allow connections
4. Verify SSL settings (DB_SSL=true for Render)

## Deployment Checklist

### Render.com Deployment

1. **Environment Variables** (Set in Render Dashboard)
   ```
   DATABASE_URL=<from Render PostgreSQL>
   JWT_SECRET=<generate secure random string>
   FRONTEND_URL=<your frontend URL>
   NODE_ENV=production
   ```

2. **Build Command**
   ```bash
   npm install && node scripts/run-migrations.js
   ```

3. **Start Command**
   ```bash
   node server.js
   ```

4. **Health Check**
   - Path: `/health`
   - Should return: `{"status":"OK"}`

## Support

If issues persist:
1. Check backend logs for detailed error messages
2. Verify database connection with test script
3. Ensure all environment variables are set
4. Clear browser cache and local storage
5. Try different wallet (test with MetaMask if using Starknet wallets)

## Files Modified

- ✅ Created: `backend/migrations/000-create-users-table.sql`
- ✅ Created: `backend/scripts/run-migrations.js`
- ✅ Fixed: `contexts/ChipiPayContext.tsx` (token key)
- ⏳ TODO: Update all components to use `engipay-token`
