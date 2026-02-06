# EngiPay Authentication Testing Checklist

## 🧪 Pre-Testing Setup

- [ ] Backend server is running on `http://localhost:3001`
- [ ] Frontend server is running on `http://localhost:3000`
- [ ] PostgreSQL database is running and connected
- [ ] `.env.local` file exists with `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001`
- [ ] Backend `.env` file has `JWT_SECRET` configured
- [ ] Browser DevTools (F12) is open for debugging

## 🎨 Landing Page Tests

### Visual Tests
- [ ] Landing page loads without errors
- [ ] Navbar displays correctly with logo and menu items
- [ ] Hero section displays with animated text
- [ ] "Get Started" button is visible and styled correctly
- [ ] Features section displays all 4 feature cards
- [ ] Workflow section displays correctly
- [ ] Stats section shows statistics
- [ ] CTA section displays
- [ ] Footer displays with all links
- [ ] Page is responsive on mobile (resize browser)
- [ ] Gradient effects and animations work

### Interaction Tests
- [ ] "Get Started" button opens auth modal
- [ ] Navbar links work (Features, Technology, About, FAQ, Help)
- [ ] Mobile menu opens and closes correctly
- [ ] All buttons have hover effects
- [ ] Smooth scrolling works for anchor links

## 🔐 Authentication Modal Tests

### Modal Behavior
- [ ] Modal opens when "Get Started" is clicked
- [ ] Modal can be closed by clicking X button
- [ ] Modal can be closed by clicking backdrop
- [ ] Modal prevents body scrolling when open
- [ ] Modal is centered on screen
- [ ] Modal is responsive on mobile

### Tab Switching
- [ ] "Wallet Connect" tab is active by default
- [ ] Clicking "Email & Password" tab switches view
- [ ] Tab indicator (green underline) moves correctly
- [ ] Tab content changes when switching tabs

## 💳 Wallet Connection Tests

### MetaMask
- [ ] MetaMask button displays with fox emoji
- [ ] Clicking MetaMask button triggers wallet extension
- [ ] "Not Installed" badge shows if MetaMask not installed
- [ ] Connection succeeds with MetaMask installed
- [ ] Loading spinner shows during connection
- [ ] Success message appears after connection
- [ ] User is redirected to dashboard
- [ ] Wallet address is stored in localStorage
- [ ] Backend receives wallet connection request
- [ ] User record is created/updated in database

### Argent Wallet
- [ ] Argent button displays with shield emoji
- [ ] Clicking Argent button triggers wallet extension
- [ ] "Not Installed" badge shows if Argent not installed
- [ ] Connection succeeds with Argent installed
- [ ] All connection steps work same as MetaMask

### Braavos Wallet
- [ ] Braavos button displays with lightning emoji
- [ ] Clicking Braavos button triggers wallet extension
- [ ] "Not Installed" badge shows if Braavos not installed
- [ ] Connection succeeds with Braavos installed
- [ ] All connection steps work same as MetaMask

### Xverse (Bitcoin)
- [ ] Xverse button displays with Bitcoin symbol
- [ ] Clicking Xverse button triggers wallet extension
- [ ] "Not Installed" badge shows if Xverse not installed
- [ ] Connection succeeds with Xverse installed
- [ ] All connection steps work same as MetaMask

### Wallet Error Handling
- [ ] Error message shows if wallet not installed
- [ ] Error message shows if user rejects connection
- [ ] Error message shows if connection fails
- [ ] User can retry after error
- [ ] Download link provided for missing wallets

## 📧 Email/Password Tests

### Signup Flow
- [ ] Switch to "Email & Password" tab
- [ ] Click "Sign up" link to switch to signup mode
- [ ] Email input field displays
- [ ] Password input field displays
- [ ] Confirm Password input field displays (signup only)
- [ ] All fields are required
- [ ] Email validation works (invalid format shows error)
- [ ] Password validation works (weak password shows error)
- [ ] Passwords must match (mismatch shows error)
- [ ] "Sign Up" button is enabled when form is valid
- [ ] Loading spinner shows during signup
- [ ] Success: User is created in database
- [ ] Success: JWT token is returned
- [ ] Success: Token is stored in localStorage
- [ ] Success: User is redirected to dashboard
- [ ] Error: Duplicate email shows error message
- [ ] Error: Weak password shows error message

### Login Flow
- [ ] Switch to "Email & Password" tab
- [ ] Email input field displays
- [ ] Password input field displays
- [ ] "Forgot password?" link displays
- [ ] All fields are required
- [ ] "Sign In" button is enabled when form is valid
- [ ] Loading spinner shows during login
- [ ] Success: JWT token is returned
- [ ] Success: Token is stored in localStorage
- [ ] Success: User is redirected to dashboard
- [ ] Error: Invalid email shows error message
- [ ] Error: Invalid password shows error message
- [ ] Error: Non-existent user shows error message

### Form Validation
- [ ] Email must be valid format (user@example.com)
- [ ] Password must be at least 8 characters
- [ ] Password must contain uppercase letter
- [ ] Password must contain lowercase letter
- [ ] Password must contain number
- [ ] Confirm password must match password (signup)
- [ ] Error messages display in red
- [ ] Error messages are clear and helpful

### Mode Switching
- [ ] "Sign up" link switches to signup mode
- [ ] "Sign in" link switches to login mode
- [ ] Form clears when switching modes
- [ ] Error messages clear when switching modes
- [ ] Confirm password field only shows in signup mode

## 🔄 Cross-Tab Tests

### Wallet to Email
- [ ] Can switch from Wallet tab to Email tab
- [ ] "Connect with Wallet Instead" button works
- [ ] Switching tabs doesn't close modal
- [ ] State is preserved when switching back

### Email to Wallet
- [ ] Can switch from Email tab to Wallet tab
- [ ] "Sign up with email" link works
- [ ] Switching tabs doesn't close modal
- [ ] State is preserved when switching back

## 🌐 Backend API Tests

### POST /api/auth/signup
```bash
curl -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123"}'
```
- [ ] Returns 201 status code
- [ ] Returns JWT token
- [ ] Returns user object
- [ ] User is created in database
- [ ] Password is hashed in database
- [ ] Duplicate email returns 400 error
- [ ] Weak password returns 400 error
- [ ] Invalid email returns 400 error

### POST /api/auth/login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123"}'
```
- [ ] Returns 200 status code
- [ ] Returns JWT token
- [ ] Returns user object
- [ ] Updates last_login in database
- [ ] Increments login_count in database
- [ ] Invalid email returns 401 error
- [ ] Invalid password returns 401 error
- [ ] Non-existent user returns 401 error

### POST /api/auth/wallet-connect
```bash
curl -X POST http://localhost:3001/api/auth/wallet-connect \
  -H "Content-Type: application/json" \
  -d '{"wallet_address":"0x1234567890abcdef","wallet_type":"metamask"}'
```
- [ ] Returns 200 status code
- [ ] Returns JWT token
- [ ] Returns user object
- [ ] Creates new user if not exists
- [ ] Updates existing user if exists
- [ ] Wallet address is stored in lowercase
- [ ] Invalid wallet type returns 400 error

### GET /api/auth/me
```bash
curl -X GET http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
- [ ] Returns 200 status code with valid token
- [ ] Returns user object
- [ ] Returns 401 error without token
- [ ] Returns 401 error with invalid token
- [ ] Returns 401 error with expired token

## 🔒 Security Tests

### Rate Limiting
- [ ] 10 failed login attempts triggers rate limit
- [ ] Rate limit returns 429 status code
- [ ] Rate limit message is clear
- [ ] Rate limit resets after 15 minutes

### Password Security
- [ ] Passwords are never returned in API responses
- [ ] Passwords are hashed in database (not plain text)
- [ ] Password hashing uses bcrypt
- [ ] Weak passwords are rejected

### JWT Token Security
- [ ] Token is signed with secret key
- [ ] Token expires after 7 days
- [ ] Token contains userId, email, wallet_address
- [ ] Token is verified on protected routes
- [ ] Invalid tokens are rejected
- [ ] Expired tokens are rejected

### Input Validation
- [ ] SQL injection attempts are blocked
- [ ] XSS attempts are sanitized
- [ ] Invalid email formats are rejected
- [ ] Invalid wallet addresses are rejected
- [ ] Empty fields are rejected

## 📱 Responsive Design Tests

### Mobile (< 768px)
- [ ] Landing page displays correctly
- [ ] Auth modal fits on screen
- [ ] Buttons are tappable (not too small)
- [ ] Text is readable
- [ ] Forms are usable
- [ ] No horizontal scrolling
- [ ] Hamburger menu works

### Tablet (768px - 1024px)
- [ ] Landing page displays correctly
- [ ] Auth modal displays correctly
- [ ] Layout adjusts appropriately
- [ ] All features are accessible

### Desktop (> 1024px)
- [ ] Landing page displays correctly
- [ ] Auth modal displays correctly
- [ ] Full navigation menu shows
- [ ] Optimal layout and spacing

## 🐛 Error Handling Tests

### Network Errors
- [ ] Backend offline shows error message
- [ ] Slow network shows loading state
- [ ] Timeout shows error message
- [ ] User can retry after error

### User Errors
- [ ] Invalid input shows error message
- [ ] Missing fields show error message
- [ ] Duplicate account shows error message
- [ ] Wrong password shows error message

### System Errors
- [ ] Database error shows generic error message
- [ ] Server error shows generic error message
- [ ] Errors are logged to console
- [ ] User is not shown sensitive error details

## 🎯 User Experience Tests

### Loading States
- [ ] Loading spinner shows during authentication
- [ ] Loading text is clear ("Signing In...", "Creating Account...")
- [ ] Buttons are disabled during loading
- [ ] User cannot submit form multiple times

### Success States
- [ ] Success message shows after authentication
- [ ] User is redirected to dashboard
- [ ] Redirect happens automatically (no manual action needed)
- [ ] Smooth transition to dashboard

### Error States
- [ ] Error messages are clear and helpful
- [ ] Error messages suggest solutions
- [ ] User can dismiss error messages
- [ ] Form remains filled after error (user doesn't lose input)

## 🔄 Integration Tests

### Wallet + Backend
- [ ] Wallet connection triggers backend API call
- [ ] Backend creates/updates user record
- [ ] JWT token is returned and stored
- [ ] User can access protected routes with token

### Email + Backend
- [ ] Email signup triggers backend API call
- [ ] Backend creates user record with hashed password
- [ ] JWT token is returned and stored
- [ ] User can login with created credentials

### Frontend + Backend
- [ ] All API routes proxy correctly to backend
- [ ] CORS is configured correctly
- [ ] Requests include correct headers
- [ ] Responses are handled correctly

## 📊 Database Tests

### User Creation
- [ ] User record is created with correct fields
- [ ] Email is stored in lowercase
- [ ] Wallet address is stored in lowercase
- [ ] Password is hashed (not plain text)
- [ ] Referral code is generated
- [ ] Timestamps are set correctly

### User Updates
- [ ] last_login is updated on login
- [ ] login_count is incremented on login
- [ ] Wallet info is updated on wallet connect
- [ ] User can have both email and wallet

### Data Integrity
- [ ] Email is unique (no duplicates)
- [ ] Wallet address is unique (no duplicates)
- [ ] Foreign key constraints work
- [ ] Indexes are created correctly

## ✅ Final Checklist

- [ ] All tests pass
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] No database errors
- [ ] Documentation is complete
- [ ] Code is clean and commented
- [ ] Environment variables are documented
- [ ] Security best practices are followed
- [ ] User experience is smooth
- [ ] System is ready for production (with email service)

## 📝 Test Results

### Date: _________________
### Tester: _________________

### Summary:
- Total Tests: _____ / _____
- Passed: _____
- Failed: _____
- Skipped: _____

### Issues Found:
1. _______________________________________________
2. _______________________________________________
3. _______________________________________________

### Notes:
_____________________________________________________
_____________________________________________________
_____________________________________________________

---

**Testing Status**: ⬜ Not Started | 🟡 In Progress | ✅ Complete
