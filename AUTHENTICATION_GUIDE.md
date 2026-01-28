# EngiPay Authentication System Guide

## Overview

EngiPay now features a complete authentication system that supports both **wallet-based authentication** and **email/password authentication**. Users can choose their preferred method to access the platform.

## Features

### 1. Dual Authentication Methods

#### Wallet Connection
- **MetaMask**: Ethereum wallet support
- **Argent**: StarkNet wallet support  
- **Braavos**: StarkNet wallet support
- **Xverse**: Bitcoin wallet support

#### Email & Password
- Traditional email/password signup and login
- Password requirements: Minimum 8 characters with uppercase, lowercase, and numbers
- Secure password hashing with bcrypt
- JWT-based session management

### 2. New Landing Page

The new landing page (`app/page.tsx`) features:
- Modern, clean design with gradient effects
- Integrated authentication modal
- Wallet connection and email/password options in one place
- Responsive design for mobile and desktop

### 3. Backend API Endpoints

All authentication endpoints are located in `backend/routes/auth.js`:

#### POST `/api/auth/signup`
Register a new user with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

**Response:**
```json
{
  "message": "User created successfully",
  "token": "jwt_token_here",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "referral_code": "ENGIXXXX",
    "created_at": "2025-01-28T..."
  }
}
```

#### POST `/api/auth/login`
Login with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "jwt_token_here",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "wallet_address": null,
    "username": null,
    ...
  }
}
```

#### POST `/api/auth/wallet-connect`
Connect wallet and create/login user.

**Request Body:**
```json
{
  "wallet_address": "0x1234...",
  "wallet_type": "metamask"
}
```

**Response:**
```json
{
  "message": "Wallet connected",
  "token": "jwt_token_here",
  "user": {
    "id": "uuid",
    "wallet_address": "0x1234...",
    "wallet_type": "metamask",
    ...
  }
}
```

#### POST `/api/auth/forgot-password`
Request password reset.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

#### POST `/api/auth/reset-password`
Reset password with token.

**Request Body:**
```json
{
  "token": "reset_token_here",
  "password": "NewSecurePass123"
}
```

#### GET `/api/auth/me`
Get current user profile (requires authentication).

**Headers:**
```
Authorization: Bearer jwt_token_here
```

## Frontend Integration

### 1. Landing Page Components

The new landing page is built with modular components located in `src/app/components/`:

- **Navbar.tsx**: Navigation bar with "Get Started" button
- **Hero.tsx**: Hero section with call-to-action
- **Features.tsx**: Feature showcase
- **Workflow.tsx**: How it works section
- **Stats.tsx**: Statistics display
- **CTA.tsx**: Call-to-action section
- **Footer.tsx**: Footer with links
- **LandingAuthModal.tsx**: Authentication modal with wallet and email options

### 2. Authentication Modal

The `LandingAuthModal` component (`src/app/components/LandingAuthModal.tsx`) provides:

- **Tab-based interface**: Switch between "Wallet Connect" and "Email & Password"
- **Wallet connection**: Integrated with WalletContext for seamless wallet connection
- **Email authentication**: Login and signup forms with validation
- **Error handling**: User-friendly error messages
- **Loading states**: Visual feedback during authentication
- **Responsive design**: Works on all screen sizes

### 3. API Routes

Next.js API routes proxy requests to the backend:

- `app/api/auth/login/route.ts`: Login endpoint
- `app/api/auth/signup/route.ts`: Signup endpoint
- `app/api/auth/wallet-connect/route.ts`: Wallet connection endpoint

### 4. Wallet Context Integration

The `WalletContext` (`contexts/WalletContext.tsx`) now:
- Automatically registers wallet connections with the backend
- Stores authentication tokens
- Manages wallet state across the application

## Setup Instructions

### 1. Environment Variables

Add to your `.env.local` file:

```env
# Backend URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001

# JWT Secret (backend)
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Frontend URL (for password reset emails)
FRONTEND_URL=http://localhost:3000
```

### 2. Install Dependencies

Backend dependencies are already included in `backend/package.json`:
- `bcryptjs`: Password hashing
- `jsonwebtoken`: JWT token generation
- `express-validator`: Request validation

### 3. Database Setup

The User model (`backend/models/User.js`) supports both authentication methods:
- `email` and `password` fields for email/password auth
- `wallet_address` and `wallet_type` fields for wallet auth
- Users can have both methods linked to the same account

### 4. Start the Backend

```bash
cd backend
npm install
npm run dev
```

The backend will run on `http://localhost:3001`

### 5. Start the Frontend

```bash
npm install
npm run dev
```

The frontend will run on `http://localhost:3000`

## Security Features

1. **Password Hashing**: Passwords are hashed using bcrypt with salt rounds
2. **JWT Tokens**: Secure token-based authentication with 7-day expiration
3. **Rate Limiting**: 10 authentication attempts per 15 minutes per IP
4. **Input Validation**: Server-side validation using express-validator
5. **CORS Protection**: Configured to only allow requests from the frontend
6. **Helmet.js**: Security headers for Express app

## User Flow

### New User with Email
1. User clicks "Get Started" on landing page
2. Modal opens with "Email & Password" tab
3. User clicks "Sign up" link
4. User enters email and password (with confirmation)
5. Backend creates user account and returns JWT token
6. User is redirected to dashboard

### Existing User with Email
1. User clicks "Get Started" on landing page
2. Modal opens with "Email & Password" tab (default: login)
3. User enters email and password
4. Backend validates credentials and returns JWT token
5. User is redirected to dashboard

### User with Wallet
1. User clicks "Get Started" on landing page
2. Modal opens with "Wallet Connect" tab
3. User selects wallet (MetaMask, Argent, Braavos, or Xverse)
4. Wallet extension prompts for connection
5. Backend creates/updates user with wallet address
6. User is redirected to dashboard

## File Structure

```
engipay/
├── app/
│   ├── page.tsx                          # New landing page (main entry)
│   ├── landing-page.tsx                  # Backup of new landing page
│   ├── page-old-backup.tsx              # Old homepage backup
│   └── api/
│       └── auth/
│           ├── login/route.ts           # Login API route
│           ├── signup/route.ts          # Signup API route
│           └── wallet-connect/route.ts  # Wallet connect API route
├── src/
│   └── app/
│       ├── LandingPage.tsx              # Landing page component
│       └── components/
│           ├── Navbar.tsx               # Navigation bar
│           ├── Hero.tsx                 # Hero section
│           ├── Features.tsx             # Features section
│           ├── Workflow.tsx             # Workflow section
│           ├── Stats.tsx                # Stats section
│           ├── CTA.tsx                  # Call-to-action
│           ├── Footer.tsx               # Footer
│           └── LandingAuthModal.tsx     # Authentication modal
├── backend/
│   ├── routes/
│   │   └── auth.js                      # Authentication routes
│   ├── models/
│   │   └── User.js                      # User model
│   └── middleware/
│       └── auth.js                      # JWT authentication middleware
└── contexts/
    └── WalletContext.tsx                # Wallet state management
```

## Testing

### Test Email Authentication

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

### Test Wallet Connection

```bash
curl -X POST http://localhost:3001/api/auth/wallet-connect \
  -H "Content-Type: application/json" \
  -d '{"wallet_address":"0x1234567890abcdef","wallet_type":"metamask"}'
```

## Troubleshooting

### Issue: "Failed to connect to authentication service"
- Ensure backend is running on port 3001
- Check `NEXT_PUBLIC_BACKEND_URL` in `.env.local`

### Issue: "Invalid email or password"
- Verify email format is correct
- Check password meets requirements (8+ chars, uppercase, lowercase, number)

### Issue: Wallet not detected
- Ensure wallet extension is installed
- Check browser console for errors
- Try refreshing the page

### Issue: JWT token expired
- Tokens expire after 7 days
- User needs to login again
- Consider implementing refresh tokens for longer sessions

## Next Steps

1. **Email Verification**: Implement email verification flow
2. **Password Reset Email**: Set up email service (e.g., SendGrid, AWS SES)
3. **Social Login**: Add Google, Twitter, Discord authentication
4. **2FA**: Implement two-factor authentication
5. **Account Linking**: Allow users to link both wallet and email to same account

## Support

For issues or questions, please check:
- Backend logs: `backend/` directory
- Frontend console: Browser developer tools
- Database: Check PostgreSQL for user records

---

**Last Updated**: January 28, 2025
**Version**: 1.0.0
