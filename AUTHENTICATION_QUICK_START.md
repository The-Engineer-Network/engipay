# EngiPay Authentication - Quick Start Guide

## What Changed?

✅ **New Landing Page**: Modern design with integrated authentication modal  
✅ **Dual Authentication**: Users can connect wallet OR use email/password  
✅ **Backend API**: Complete authentication endpoints with JWT tokens  
✅ **Wallet Integration**: Automatic backend registration when wallet connects  
✅ **Security**: Password hashing, rate limiting, and JWT-based sessions  

## File Changes Summary

### New Files Created
- `app/page.tsx` - New landing page (replaces old homepage)
- `app/api/auth/login/route.ts` - Login API endpoint
- `app/api/auth/signup/route.ts` - Signup API endpoint
- `app/api/auth/wallet-connect/route.ts` - Wallet connection API endpoint
- `backend/routes/auth.js` - Complete authentication backend
- `AUTHENTICATION_GUIDE.md` - Comprehensive documentation

### Modified Files
- `src/app/components/LandingAuthModal.tsx` - Enhanced with wallet + email auth
- `contexts/WalletContext.tsx` - Added backend registration on wallet connect
- `app/page-old-backup.tsx` - Backup of old homepage

### Renamed Files
- `src/app/page.tsx` → `src/app/LandingPage.tsx`
- `src/app/components/AuthModal.tsx` → `src/app/components/LandingAuthModal.tsx`

## Quick Setup (5 Minutes)

### 1. Environment Variables

Create `.env.local` in root directory:
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

Backend `.env` already has JWT configuration in `backend/.env.example`

### 2. Start Backend

```bash
cd backend
npm install  # If not already done
npm run dev
```

Backend runs on: `http://localhost:3001`

### 3. Start Frontend

```bash
npm install  # If not already done
npm run dev
```

Frontend runs on: `http://localhost:3000`

### 4. Test It Out!

1. Open `http://localhost:3000`
2. Click "Get Started" button
3. Try both authentication methods:
   - **Wallet Connect**: Click MetaMask/Argent/Braavos/Xverse
   - **Email/Password**: Switch to "Email & Password" tab

## Authentication Flow

### Email/Password Signup
```
User clicks "Get Started" 
→ Opens modal 
→ Switches to "Email & Password" tab 
→ Clicks "Sign up" 
→ Enters email + password 
→ Backend creates account 
→ Returns JWT token 
→ Redirects to dashboard
```

### Email/Password Login
```
User clicks "Get Started" 
→ Opens modal (Email tab by default)
→ Enters email + password 
→ Backend validates credentials 
→ Returns JWT token 
→ Redirects to dashboard
```

### Wallet Connection
```
User clicks "Get Started" 
→ Opens modal (Wallet tab)
→ Selects wallet (MetaMask/Argent/Braavos/Xverse)
→ Wallet prompts for connection 
→ Frontend gets wallet address 
→ Backend creates/updates user 
→ Returns JWT token 
→ Redirects to dashboard
```

## API Endpoints

All endpoints are at `http://localhost:3001/api/auth/`

### POST `/signup`
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

### POST `/login`
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

### POST `/wallet-connect`
```json
{
  "wallet_address": "0x1234...",
  "wallet_type": "metamask"
}
```

### GET `/me` (Protected)
Requires: `Authorization: Bearer <token>`

## Testing

### Test Email Auth (Terminal)
```bash
# Signup
curl -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123"}'

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123"}'
```

### Test in Browser
1. Open `http://localhost:3000`
2. Open browser DevTools (F12)
3. Click "Get Started"
4. Try signup/login
5. Check Console for API responses
6. Check Application → Local Storage for tokens

## Security Features

✅ **Password Requirements**: 8+ chars, uppercase, lowercase, number  
✅ **Bcrypt Hashing**: Secure password storage  
✅ **JWT Tokens**: 7-day expiration  
✅ **Rate Limiting**: 10 auth attempts per 15 minutes  
✅ **Input Validation**: Server-side validation  
✅ **CORS Protection**: Only allows frontend requests  

## Common Issues

### "Failed to connect to authentication service"
**Solution**: Make sure backend is running on port 3001

### "Invalid email or password"
**Solution**: Check password meets requirements (8+ chars, uppercase, lowercase, number)

### Wallet not detected
**Solution**: Install wallet extension and refresh page

### Token expired
**Solution**: Tokens expire after 7 days, user needs to login again

## What's Next?

The authentication system is fully functional! Here are optional enhancements:

1. **Email Verification**: Send verification emails on signup
2. **Password Reset Emails**: Configure email service (SendGrid/AWS SES)
3. **Social Login**: Add Google, Twitter, Discord
4. **2FA**: Two-factor authentication
5. **Account Linking**: Link wallet + email to same account

## Need Help?

- **Full Documentation**: See `AUTHENTICATION_GUIDE.md`
- **Backend Logs**: Check `backend/` terminal
- **Frontend Logs**: Check browser console (F12)
- **Database**: Check PostgreSQL for user records

---

**Ready to go!** 🚀 Your authentication system is set up and working.
