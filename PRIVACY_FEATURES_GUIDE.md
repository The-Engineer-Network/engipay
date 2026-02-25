# EngiPay Privacy Features - User Guide 🔒

## Overview
EngiPay now supports **privacy-shielded transactions** using Tongo SDK, allowing users to send payments with hidden amounts while maintaining full auditability.

---

## What is Private Payment?

Private payments use **ElGamal encryption** to hide transaction amounts on the blockchain. Only the sender and recipient can see the actual amount, while the transaction remains verifiable through zero-knowledge proofs.

### Key Benefits:
- 🔒 **Hidden Amounts**: Transaction amounts are encrypted
- ✅ **Verifiable**: Zero-knowledge proofs ensure validity
- 👁️ **Auditable**: Viewing keys allow selective disclosure
- 🔐 **Secure**: No trusted setup, pure cryptography
- 🌐 **On-Chain**: All privacy happens on StarkNet

---

## How to Use Privacy Features

### 1. Send Private Payment

#### Via UI:
1. Go to "Send Payment" section
2. Enter recipient address and amount
3. **Check the "Private Payment" checkbox** 🔒
4. Click "Send Payment"
5. Sign the transaction in your wallet
6. Amount will be encrypted automatically

#### Via API:
```bash
POST /api/payments/v2/private-send
Authorization: Bearer YOUR_TOKEN

{
  "recipient": "0x...",
  "asset": "STRK",
  "amount": "1000000000000000000",
  "memo": "Confidential payment"
}
```

**Response:**
```json
{
  "success": true,
  "transaction_id": "tx_private_...",
  "is_private": true,
  "privacy_protocol": "tongo",
  "instructions": "This payment will use Tongo encryption to hide the amount"
}
```

---

### 2. Shield Tokens (Wrap with Encryption)

Convert your public ERC20 tokens into private Tongo tokens.

#### API Call:
```bash
POST /api/payments/v2/shield
Authorization: Bearer YOUR_TOKEN

{
  "asset": "STRK",
  "amount": "5000000000000000000"
}
```

**What Happens:**
- Your STRK tokens are deposited into Tongo wrapper
- You receive encrypted Tongo-STRK tokens
- Your balance is now private

---

### 3. Unshield Tokens (Unwrap to Public)

Convert your private Tongo tokens back to public ERC20 tokens.

#### API Call:
```bash
POST /api/payments/v2/unshield
Authorization: Bearer YOUR_TOKEN

{
  "asset": "STRK",
  "amount": "2000000000000000000"
}
```

**What Happens:**
- Your Tongo-STRK tokens are unwrapped
- You receive public STRK tokens
- Balance becomes visible on-chain

---

### 4. Check Encrypted Balance

View your encrypted token balance.

#### API Call:
```bash
GET /api/payments/v2/encrypted-balance?asset=STRK
Authorization: Bearer YOUR_TOKEN
```

**Response:**
```json
{
  "success": true,
  "address": "0x...",
  "asset": "STRK",
  "encrypted_balance": "0x...",
  "public_key": "0x...",
  "message": "Balance is encrypted. Use viewing key to decrypt."
}
```

---

### 5. Generate Viewing Key (For Auditing)

Create a key that allows others to view your transaction amounts.

#### API Call:
```bash
POST /api/payments/v2/generate-viewing-key
Authorization: Bearer YOUR_TOKEN
```

**Use Cases:**
- Tax compliance
- Audit requirements
- Regulatory reporting
- Voluntary disclosure

**Important:** Only share viewing keys with trusted parties!

---

## Privacy Workflow Examples

### Example 1: Confidential Salary Payment

**Scenario:** Company wants to pay employee without revealing salary on-chain.

```
1. Company shields USDC tokens
   POST /api/payments/v2/shield
   { "asset": "USDC", "amount": "5000000000" }

2. Company sends private payment
   POST /api/payments/v2/private-send
   { "recipient": "0xEmployee", "asset": "USDC", "amount": "5000000000" }

3. Employee receives encrypted USDC
   (Amount hidden from public)

4. Employee unshields to spend
   POST /api/payments/v2/unshield
   { "asset": "USDC", "amount": "5000000000" }
```

---

### Example 2: Private Donation

**Scenario:** Donor wants to contribute without revealing amount.

```
1. Donor enables "Private Payment" toggle in UI
2. Enters charity address and amount
3. Clicks "Send Payment"
4. Transaction shows on-chain but amount is encrypted
5. Only donor and charity know the amount
```

---

### Example 3: Compliance with Viewing Key

**Scenario:** User needs to prove income for tax purposes.

```
1. User generates viewing key
   POST /api/payments/v2/generate-viewing-key

2. User shares viewing key with accountant
   (Accountant can now decrypt transaction amounts)

3. Accountant verifies income without accessing wallet
   (Privacy maintained from general public)
```

---

## Supported Tokens

Currently, privacy features support:

| Token | Symbol | Decimals | Status |
|-------|--------|----------|--------|
| Ethereum | ETH | 18 | ✅ Ready |
| StarkNet Token | STRK | 18 | ✅ Ready |
| USD Coin | USDC | 6 | ✅ Ready |
| EngiToken | ENGI | 18 | ✅ Ready |

**Note:** Contract addresses must be configured in environment variables.

---

## Technical Details

### Encryption Method
- **Algorithm**: ElGamal encryption over Stark curve
- **Key Size**: 256-bit
- **Proof System**: Zero-knowledge proofs (ZKP)
- **Homomorphic**: Yes (encrypted balance operations)

### Gas Costs
Private transactions cost more gas due to:
- Encryption operations
- Zero-knowledge proof generation
- Additional on-chain verification

**Estimated Gas Increase:** 2-3x normal transaction

### Security Guarantees
- ✅ Amount privacy from public
- ✅ Transaction validity provable
- ✅ No trusted setup required
- ✅ Quantum-resistant (elliptic curve based)
- ✅ Auditable with viewing keys

---

## Privacy Best Practices

### DO:
✅ Use private payments for sensitive transactions  
✅ Shield tokens before private transfers  
✅ Generate viewing keys for compliance  
✅ Test on testnet first  
✅ Keep viewing keys secure  

### DON'T:
❌ Share viewing keys publicly  
❌ Use for illegal activities  
❌ Forget to unshield before spending  
❌ Ignore gas cost differences  
❌ Skip testnet testing  

---

## Troubleshooting

### Issue: "Insufficient encrypted balance"
**Solution:** Shield more tokens first using `/api/payments/v2/shield`

### Issue: "Private transfer failed"
**Solution:** Ensure you have shielded tokens and sufficient gas

### Issue: "Cannot decrypt balance"
**Solution:** You need the viewing key to decrypt. Generate one if needed.

### Issue: "High gas costs"
**Solution:** Private transactions require more gas for ZK proofs. This is expected.

---

## API Reference

### Private Payment Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/payments/v2/private-send` | POST | Send private payment |
| `/api/payments/v2/shield` | POST | Wrap tokens with encryption |
| `/api/payments/v2/unshield` | POST | Unwrap to public tokens |
| `/api/payments/v2/encrypted-balance` | GET | Get encrypted balance |
| `/api/payments/v2/generate-viewing-key` | POST | Generate viewing key |

### Request Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

---

## Frontend Integration

### Using the Privacy Toggle

The SendPayment component now includes a privacy toggle:

```tsx
<div className="flex items-center gap-2">
  <input
    type="checkbox"
    id="private-payment"
    checked={isPrivate}
    onChange={(e) => setIsPrivate(e.target.checked)}
  />
  <label htmlFor="private-payment">
    Private Payment (Hide Amount) 🔒
  </label>
</div>
```

When checked:
- Payment routes to `/api/payments/v2/private-send`
- Amount is encrypted with Tongo
- Transaction marked as private in database
- Success message indicates privacy

---

## Compliance & Regulations

### Viewing Keys for Compliance

Viewing keys allow you to:
- Prove income for tax purposes
- Comply with audit requirements
- Satisfy regulatory reporting
- Maintain privacy from general public

### Selective Disclosure

You control who can see your transaction amounts:
- Generate viewing key
- Share only with authorized parties
- Revoke access by not sharing key
- Maintain privacy from everyone else

---

## Future Enhancements

Planned privacy features:
- [ ] Batch private transfers
- [ ] Scheduled private payments
- [ ] Multi-signature private transactions
- [ ] Privacy pools for enhanced anonymity
- [ ] Mobile app privacy features

---

## Support & Resources

### Documentation:
- **Tongo Docs**: https://docs.tongo.cash/
- **EngiPay Docs**: See `TONGO_INTEGRATION_COMPLETE.md`

### Need Help?
- Check troubleshooting section above
- Review API documentation
- Test on Sepolia testnet first
- Contact support for issues

---

## Summary

EngiPay's privacy features powered by Tongo SDK provide:

🔒 **Transaction Privacy**: Hidden amounts on-chain  
✅ **Verifiable Security**: Zero-knowledge proofs  
👁️ **Selective Disclosure**: Viewing keys for compliance  
🚀 **Easy to Use**: Simple checkbox in UI  
🔐 **No Compromise**: Full security and auditability  

**Start using private payments today for confidential transactions!**
