# 🧪 QA Testing Guide - EngiPay Hackathon Features

**Version:** 1.0.0  
**Last Updated:** February 11, 2026  
**Target:** Hackathon Demo Features Only

---

## 📋 Overview

This guide focuses ONLY on the features we're demonstrating for the hackathon. Don't waste time testing features we're not showcasing!

### ✅ What to Test (Hackathon Features)
1. Cross-Chain Swaps (BTC ↔ STRK)
2. Payment System (Send payments)
3. Escrow Protection System
4. QR Code Scanner
5. Transaction History with Filters
6. Wallet Connections

### ❌ What NOT to Test (Not in Hackathon Demo)
- DeFi features (lending, borrowing, staking)
- Analytics dashboard
- Notification system
- Admin features
- Governance features

---

## 🎯 Testing Priority

### Priority 1: CRITICAL (Must Work for Demo) 🔴
- Cross-chain swaps
- Payment sending
- Wallet connections
- Transaction history

### Priority 2: IMPORTANT (Should Work) 🟡
- Escrow system
- QR scanner
- Transaction filters

### Priority 3: NICE TO HAVE (Optional) 🟢
- UI animations
- Error messages
- Loading states

---

## 📁 Files to Test

### Frontend Components (7 files)

```
components/payments/
├── SendPayment.tsx           ✅ CRITICAL - Test payment sending
├── EscrowPayments.tsx        🟡 IMPORTANT - Test escrow creation/accept/reject
├── BtcSwap.tsx               ✅ CRITICAL - Test cross-chain swaps
├── SwapHistory.tsx           ✅ CRITICAL - Test swap history display
├── QRScanner.tsx             🟡 IMPORTANT - Test QR scanning
├── TransactionHistory.tsx    ✅ CRITICAL - Test transaction list & filters
└── PaymentModals.tsx         🟡 IMPORTANT - Test modal interactions

contexts/
└── WalletContext.tsx         ✅ CRITICAL - Test wallet connections

app/
├── dashboard/page.tsx        🟡 IMPORTANT - Test dashboard display
└── payments-swaps/page.tsx   ✅ CRITICAL - Test main payments page
```

### Backend Routes (3 files)

```
backend/routes/
├── payments-v2.js            ✅ CRITICAL - 8 payment endpoints
├── escrow.js                 🟡 IMPORTANT - 8 escrow endpoints
└── swaps-atomiq.js           ✅ CRITICAL - 10 swap endpoints
```

### Backend Services (3 files)

```
backend/services/
├── atomiqService.js          ✅ CRITICAL - Atomiq SDK integration
├── escrowService.js          🟡 IMPORTANT - Escrow logic
└── blockchainService.js      ✅ CRITICAL - Blockchain interactions
```

### Smart Contracts (3 files)

```
smart-contracts/contracts/
├── EngiToken.cairo           🟡 IMPORTANT - Token contract
├── EscrowV2.cairo            🟡 IMPORTANT - Escrow contract
└── RewardDistributorV2.cairo 🟢 OPTIONAL - Not used in demo
```

**Total Files to Test: 16 files** (not the entire codebase!)

---

## 🧪 Test Cases by Feature

### Feature 1: Cross-Chain Swaps (CRITICAL) 🔴

**Files to Check:**
- `components/payments/BtcSwap.tsx`
- `components/payments/SwapHistory.tsx`
- `backend/routes/swaps-atomiq.js`
- `backend/services/atomiqService.js`

**Test Cases:**

#### TC1.1: Get Swap Quote
```
Steps:
1. Navigate to Payments & Swaps page
2. Select "Swap" tab
3. Choose BTC → STRK
4. Enter amount: 0.001 BTC
5. Click "Get Quote"

Expected:
✅ Quote displays within 3 seconds
✅ Shows exchange rate
✅ Shows estimated STRK amount
✅ Shows fees
✅ No errors in console

Files: BtcSwap.tsx (lines 50-80), swaps-atomiq.js (lines 20-50)
```

#### TC1.2: Execute Swap
```
Steps:
1. Get quote (TC1.1)
2. Click "Execute Swap"
3. Sign transaction in wallet
4. Wait for confirmation

Expected:
✅ Wallet prompt appears
✅ Transaction submits successfully
✅ Swap ID generated
✅ Status shows "pending"
✅ Explorer link works

Files: BtcSwap.tsx (lines 100-150), swaps-atomiq.js (lines 60-100)
```

#### TC1.3: View Swap History
```
Steps:
1. Navigate to Swap History tab
2. View list of swaps

Expected:
✅ All user swaps displayed
✅ Status shows correctly (pending/completed/failed)
✅ Amounts display correctly
✅ Timestamps are accurate
✅ Can click for details

Files: SwapHistory.tsx (lines 30-100), swaps-atomiq.js (lines 120-150)
```

#### TC1.4: Claim Completed Swap
```
Steps:
1. Find completed swap in history
2. Click "Claim" button
3. Sign transaction

Expected:
✅ Claim button only shows for completed swaps
✅ Transaction executes
✅ Funds received
✅ Status updates to "claimed"

Files: SwapHistory.tsx (lines 120-160), swaps-atomiq.js (lines 180-210)
```

**API Endpoints to Test:**
```bash
# Get quote
POST /api/swap/atomiq/quote
Body: { "from_token": "BTC", "to_token": "STRK", "amount": "0.001" }

# Execute swap
POST /api/swap/atomiq/initiate
Body: { "from_token": "BTC", "to_token": "STRK", "amount": "0.001" }

# Get history
GET /api/swap/atomiq/history

# Claim swap
POST /api/swap/atomiq/:id/claim
```

---

### Feature 2: Payment System (CRITICAL) 🔴

**Files to Check:**
- `components/payments/SendPayment.tsx`
- `backend/routes/payments-v2.js`
- `backend/services/blockchainService.js`

**Test Cases:**

#### TC2.1: Send Payment
```
Steps:
1. Navigate to Payments & Swaps page
2. Select "Send" tab
3. Enter recipient address
4. Enter amount: 1 STRK
5. Add memo (optional)
6. Click "Send Payment"
7. Sign transaction in wallet

Expected:
✅ Form validation works
✅ Wallet prompt appears
✅ Transaction submits
✅ Transaction hash generated
✅ Explorer link works
✅ Balance updates

Files: SendPayment.tsx (lines 40-120), payments-v2.js (lines 20-80)
```

#### TC2.2: Payment with Invalid Address
```
Steps:
1. Enter invalid address (e.g., "0x123")
2. Try to send payment

Expected:
✅ Error message displays
✅ "Invalid address format"
✅ Send button disabled
✅ No transaction submitted

Files: SendPayment.tsx (lines 30-40), payments-v2.js (lines 35-45)
```

#### TC2.3: Payment with Insufficient Balance
```
Steps:
1. Enter amount > wallet balance
2. Try to send payment

Expected:
✅ Error message displays
✅ "Insufficient balance"
✅ Transaction fails gracefully

Files: SendPayment.tsx (lines 50-60)
```

**API Endpoints to Test:**
```bash
# Prepare payment
POST /api/payments/v2/send
Body: { "recipient": "0x...", "amount": "1", "asset": "STRK" }

# Execute payment
POST /api/payments/v2/execute
Body: { "transaction_id": "tx_...", "tx_hash": "0x..." }

# Get balance
GET /api/payments/v2/balance?asset=STRK
```

---

### Feature 3: Escrow System (IMPORTANT) 🟡

**Files to Check:**
- `components/payments/EscrowPayments.tsx`
- `backend/routes/escrow.js`
- `backend/services/escrowService.js`

**Test Cases:**

#### TC3.1: Create Escrow Request
```
Steps:
1. Navigate to Escrow tab
2. Enter recipient address
3. Enter amount: 5 STRK
4. Select expiry: 24 hours
5. Add memo
6. Click "Create Request"
7. Sign transaction

Expected:
✅ Request created
✅ Request ID generated
✅ Payment link generated
✅ QR code generated
✅ Expiry time set correctly

Files: EscrowPayments.tsx (lines 80-150), escrow.js (lines 20-80)
```

#### TC3.2: Accept Payment Request
```
Steps:
1. View pending request (as recipient)
2. Click "Accept" button
3. Sign transaction

Expected:
✅ Accept button only shows for recipient
✅ Transaction executes
✅ Funds released to recipient
✅ Status updates to "accepted"

Files: EscrowPayments.tsx (lines 180-220), escrow.js (lines 100-140)
```

#### TC3.3: Reject Payment Request
```
Steps:
1. View pending request (as recipient)
2. Click "Reject" button
3. Sign transaction

Expected:
✅ Reject button only shows for recipient
✅ Transaction executes
✅ Funds returned to sender
✅ Status updates to "rejected"

Files: EscrowPayments.tsx (lines 240-280), escrow.js (lines 160-200)
```

**API Endpoints to Test:**
```bash
# Create escrow
POST /api/escrow/create
Body: { "to_address": "0x...", "amount": "5", "asset": "STRK", "expiry_hours": 24 }

# Accept payment
POST /api/escrow/accept
Body: { "request_id": "escrow_..." }

# Reject payment
POST /api/escrow/reject
Body: { "request_id": "escrow_..." }

# Get requests
GET /api/escrow/requests?type=all
```

---

### Feature 4: QR Scanner (IMPORTANT) 🟡

**Files to Check:**
- `components/payments/QRScanner.tsx`
- `components/payments/PaymentModals.tsx`

**Test Cases:**

#### TC4.1: Open QR Scanner
```
Steps:
1. Navigate to Payments page
2. Click "Scan QR Code" button

Expected:
✅ Camera permission prompt appears
✅ Camera feed displays
✅ Scanner UI shows
✅ No errors in console

Files: QRScanner.tsx (lines 20-50)
```

#### TC4.2: Scan Valid QR Code
```
Steps:
1. Open QR scanner
2. Point camera at payment QR code
3. Wait for scan

Expected:
✅ QR code detected
✅ Payment data parsed
✅ Payment form pre-filled
✅ User can confirm payment

Files: QRScanner.tsx (lines 60-100)
```

#### TC4.3: Scan Invalid QR Code
```
Steps:
1. Open QR scanner
2. Scan non-payment QR code

Expected:
✅ Error message displays
✅ "Invalid QR code format"
✅ Scanner remains active
✅ User can try again

Files: QRScanner.tsx (lines 80-90)
```

---

### Feature 5: Transaction History (CRITICAL) 🔴

**Files to Check:**
- `components/payments/TransactionHistory.tsx`
- `backend/routes/transactions.js`

**Test Cases:**

#### TC5.1: View Transaction List
```
Steps:
1. Navigate to History tab
2. View transaction list

Expected:
✅ All transactions displayed
✅ Sorted by date (newest first)
✅ Shows type, amount, status
✅ Shows timestamps
✅ Explorer links work

Files: TransactionHistory.tsx (lines 40-100)
```

#### TC5.2: Filter by Type
```
Steps:
1. Open filter dropdown
2. Select "Payments" only
3. Apply filter

Expected:
✅ Only payment transactions shown
✅ Swaps and escrow hidden
✅ Count updates correctly
✅ Can clear filter

Files: TransactionHistory.tsx (lines 120-150)
```

#### TC5.3: Filter by Status
```
Steps:
1. Open status filter
2. Select "Completed" only
3. Apply filter

Expected:
✅ Only completed transactions shown
✅ Pending/failed hidden
✅ Filter persists on refresh

Files: TransactionHistory.tsx (lines 160-180)
```

#### TC5.4: Search by Address
```
Steps:
1. Enter address in search box
2. Press search

Expected:
✅ Matching transactions shown
✅ Search is case-insensitive
✅ Partial matches work
✅ Can clear search

Files: TransactionHistory.tsx (lines 200-230)
```

#### TC5.5: Date Range Filter
```
Steps:
1. Select start date
2. Select end date
3. Apply filter

Expected:
✅ Only transactions in range shown
✅ Date validation works
✅ Can clear date filter

Files: TransactionHistory.tsx (lines 250-280)
```

**API Endpoints to Test:**
```bash
# Get all transactions
GET /api/transactions

# Filter by type
GET /api/transactions?type=payment

# Filter by status
GET /api/transactions?status=completed

# Search
GET /api/transactions?search=0x123...

# Date range
GET /api/transactions?start_date=2024-01-01&end_date=2024-12-31
```

---

### Feature 6: Wallet Connections (CRITICAL) 🔴

**Files to Check:**
- `contexts/WalletContext.tsx`
- `components/WalletConnectModal.tsx`

**Test Cases:**

#### TC6.1: Connect ArgentX Wallet
```
Steps:
1. Click "Connect Wallet"
2. Select "ArgentX"
3. Approve connection in wallet

Expected:
✅ Wallet connects successfully
✅ Address displays correctly
✅ Balance loads
✅ Connection persists on refresh

Files: WalletContext.tsx (lines 50-100)
```

#### TC6.2: Connect Braavos Wallet
```
Steps:
1. Click "Connect Wallet"
2. Select "Braavos"
3. Approve connection

Expected:
✅ Wallet connects successfully
✅ Address displays correctly
✅ Balance loads

Files: WalletContext.tsx (lines 50-100)
```

#### TC6.3: Connect Xverse Wallet (Bitcoin)
```
Steps:
1. Click "Connect Wallet"
2. Select "Xverse"
3. Approve connection

Expected:
✅ Wallet connects successfully
✅ BTC address displays
✅ BTC balance loads

Files: WalletContext.tsx (lines 120-160)
```

#### TC6.4: Disconnect Wallet
```
Steps:
1. Connect wallet (any)
2. Click "Disconnect"

Expected:
✅ Wallet disconnects
✅ Address cleared
✅ Balance cleared
✅ Session cleared

Files: WalletContext.tsx (lines 180-200)
```

#### TC6.5: Switch Wallets
```
Steps:
1. Connect ArgentX
2. Disconnect
3. Connect Braavos

Expected:
✅ First wallet disconnects cleanly
✅ Second wallet connects
✅ No conflicts
✅ Correct balance displays

Files: WalletContext.tsx (lines 50-200)
```

---

## 🔧 Smart Contract Testing

### Contracts to Test (When Deployed)

#### Contract 1: EscrowV2.cairo

**Functions to Test:**
```cairo
1. create_payment_request()
   - Creates escrow request
   - Locks funds
   - Sets expiry

2. accept_payment()
   - Releases funds to recipient
   - Updates status

3. reject_payment()
   - Returns funds to sender
   - Updates status

4. claim_expired()
   - Returns funds after expiry
```

**Test Cases:**
```
TC-SC1: Create escrow request
- Call create_payment_request()
- Verify funds locked
- Verify request ID generated

TC-SC2: Accept payment
- Call accept_payment()
- Verify funds released
- Verify status updated

TC-SC3: Reject payment
- Call reject_payment()
- Verify funds returned
- Verify status updated

TC-SC4: Expired request
- Wait for expiry
- Call claim_expired()
- Verify funds returned
```

**Files:** `smart-contracts/contracts/EscrowV2.cairo`

---

## 🐛 Bug Reporting Template

When you find a bug, report it like this:

```markdown
## Bug Report

**Feature:** [e.g., Cross-Chain Swaps]
**File:** [e.g., components/payments/BtcSwap.tsx]
**Line:** [e.g., Line 85]
**Priority:** [Critical/Important/Minor]

**Steps to Reproduce:**
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior:**
What should happen

**Actual Behavior:**
What actually happens

**Screenshots:**
[Attach if applicable]

**Console Errors:**
[Copy any error messages]

**Environment:**
- Browser: [e.g., Chrome 120]
- Wallet: [e.g., ArgentX]
- Network: [e.g., StarkNet Mainnet]
```

---

## ✅ Testing Checklist

### Pre-Testing Setup
- [ ] Backend server running (port 3001)
- [ ] Frontend server running (port 3000)
- [ ] Database connected
- [ ] Wallets installed (ArgentX, Braavos, Xverse)
- [ ] Test tokens available

### Feature Testing
- [ ] Cross-chain swaps (4 test cases)
- [ ] Payment system (3 test cases)
- [ ] Escrow system (3 test cases)
- [ ] QR scanner (3 test cases)
- [ ] Transaction history (5 test cases)
- [ ] Wallet connections (5 test cases)

### API Testing
- [ ] Payment endpoints (8 endpoints)
- [ ] Escrow endpoints (8 endpoints)
- [ ] Swap endpoints (10 endpoints)

### Smart Contract Testing (When Deployed)
- [ ] EscrowV2 contract (4 functions)
- [ ] EngiToken contract (basic functions)

### Final Checks
- [ ] No console errors
- [ ] All links work
- [ ] Mobile responsive
- [ ] Loading states work
- [ ] Error messages clear

---

## 📊 Test Results Template

```markdown
# Test Results - [Date]

## Summary
- Total Test Cases: 23
- Passed: __
- Failed: __
- Blocked: __
- Pass Rate: __%

## Critical Features (Priority 1)
- Cross-Chain Swaps: ✅/❌
- Payment System: ✅/❌
- Transaction History: ✅/❌
- Wallet Connections: ✅/❌

## Important Features (Priority 2)
- Escrow System: ✅/❌
- QR Scanner: ✅/❌

## Bugs Found
1. [Bug description] - Priority: Critical
2. [Bug description] - Priority: Important

## Recommendations
- [Recommendation 1]
- [Recommendation 2]

## Sign-off
Tested by: [Name]
Date: [Date]
Status: Ready for Demo / Needs Fixes
```

---

## 🎯 Focus Areas for Auditors

### Security Checks
1. **Input Validation**
   - Check: `backend/routes/payments-v2.js` (lines 20-30)
   - Check: `backend/routes/escrow.js` (lines 20-30)
   - Verify all user inputs are validated

2. **Authentication**
   - Check: `backend/middleware/auth.js`
   - Verify JWT tokens work correctly
   - Test unauthorized access

3. **Transaction Signing**
   - Check: `components/payments/SendPayment.tsx` (lines 80-100)
   - Verify wallet signatures required
   - Test transaction rejection

### Performance Checks
1. **API Response Times**
   - All endpoints should respond < 2 seconds
   - Swap quotes should load < 3 seconds

2. **UI Responsiveness**
   - Page loads < 3 seconds
   - Smooth animations (60fps)
   - No UI freezing

### Code Quality Checks
1. **Error Handling**
   - All try-catch blocks present
   - User-friendly error messages
   - No exposed stack traces

2. **Code Organization**
   - Clean file structure
   - Consistent naming
   - Proper comments

---

## 📞 Support

**Questions during testing?**
- Check: `HACKATHON_READY_FEATURES.md` for feature details
- Check: `COMPLETE_SYSTEM_DOCUMENTATION.md` for API docs
- Check: `README.md` for setup instructions

**Found critical bugs?**
- Report immediately to development team
- Use bug report template above
- Include screenshots and console logs

---

**Testing Status:** Ready to Begin  
**Estimated Time:** 4-6 hours for complete testing  
**Priority:** Focus on Critical features first!

**Good luck with testing! 🧪**
