# Quick Fix Commands - Copy & Paste

## 🚀 Run These Commands in Order

### 1. Create Database Tables
```bash
cd backend
node scripts/run-migrations.js
```

### 2. Restart Backend
```bash
cd backend
npm start
```

### 3. Test Database Connection
```bash
cd backend
node scripts/test-starknet-connection.js
```

## 🌐 For Render.com Deployment

### Set Environment Variables in Render Dashboard:
```env
DATABASE_URL=<from Render PostgreSQL>
JWT_SECRET=<generate secure random string>
FRONTEND_URL=https://your-frontend.vercel.app
NODE_ENV=production
```

### Build Command:
```bash
npm install && node scripts/run-migrations.js
```

### Start Command:
```bash
node server.js
```

## 🧹 Clear Browser Storage (Users)

1. Press `F12` (DevTools)
2. Go to `Application` > `Local Storage`
3. Delete all items
4. Refresh page
5. Reconnect wallet

## ✅ Verify Everything Works

### Check Backend Health:
```bash
curl https://your-backend.onrender.com/health
```

### Check Database:
```bash
cd backend
node -e "const {sequelize} = require('./config/database'); sequelize.authenticate().then(() => console.log('✅ DB OK')).catch(e => console.log('❌', e.message))"
```

## 🐛 If Still Broken

### Check Backend Logs:
- Go to Render Dashboard
- Click your service
- View "Logs" tab

### Check Frontend Console:
- Press F12
- Go to "Console" tab
- Look for errors

### Verify Token Storage:
- Press F12
- Go to "Application" > "Local Storage"
- Should see: `engipay-token`, `engipay-wallet`, `engipay-user`

## 📝 Summary of Changes

✅ Created User table migration
✅ Fixed token storage (auth-token → engipay-token)
✅ Updated 9 component files
✅ Created migration runner script
✅ Documented ChipiPay implementation

## 🎯 Expected Results

After running these commands:
- ✅ No "relation User does not exist" error
- ✅ No "No authentication token" error
- ✅ Wallet connects successfully
- ✅ Swap/Payments page loads
- ✅ Transaction history accessible

---

**Need Help?** See [SETUP_AND_FIX.md](./SETUP_AND_FIX.md) for detailed guide
