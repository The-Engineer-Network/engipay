# MongoDB Cleanup Action Plan
**Date**: February 9, 2026  
**Priority**: 🔴 CRITICAL - MUST DO TODAY

---

## 🎯 OBJECTIVE
Remove ALL MongoDB/Mongoose dependencies and convert everything to PostgreSQL/Sequelize.

---

## 📋 FILES THAT NEED CONVERSION

### Mongoose Models to Convert (8 files)
1. ✅ `backend/models/Wallet.js` - Already converted to Sequelize
2. ❌ `backend/models/Notification.js` - MIXED (has both Mongoose and Sequelize code!)
3. ❌ `backend/models/SwapQuote.js` - Simple Mongoose model
4. ❌ `backend/models/Swap.js` - Simple Mongoose model
5. ❌ `backend/models/Reward.js` - Complex Mongoose model
6. ❌ `backend/models/DeFiPosition.js` - Complex Mongoose model
7. ❌ `backend/models/Analytics.js` - Complex Mongoose model
8. ❌ `backend/models/YieldFarm.js` - Complex Mongoose model

### Test Files to Update
- `backend/tests/swaps.test.js` - Uses mongodb-memory-server

### Configuration Files
- `backend/models/index.js` - Currently exports Mongoose models
- `backend/package.json` - Should NOT have mongoose dependencies

---

## 🚨 CRITICAL FINDING: Notification.js is BROKEN!

The file `backend/models/Notification.js` has **BOTH** Sequelize and Mongoose code mixed together!

**Lines 1-50**: Sequelize definition
**Lines 51-end**: Mongoose schema definition

This file is completely broken and needs to be fixed immediately.

---

## ✅ ACTION PLAN

### Step 1: Fix Notification.js (IMMEDIATE)
- Remove all Mongoose code
- Keep only Sequelize definition
- Test the model

### Step 2: Convert Simple Models (30 minutes)
- SwapQuote.js
- Swap.js

### Step 3: Convert Complex Models (2 hours)
- Reward.js
- DeFiPosition.js  
- Analytics.js
- YieldFarm.js

### Step 4: Update index.js (15 minutes)
- Remove Mongoose model exports
- Add new Sequelize models
- Test all imports

### Step 5: Update Tests (30 minutes)
- Remove mongodb-memory-server
- Use PostgreSQL test database
- Update test setup

### Step 6: Remove Dependencies (5 minutes)
```bash
# These should NOT be in package.json
# If they are, remove them:
npm uninstall mongoose mongodb mongodb-memory-server
```

### Step 7: Create Migration Scripts (1 hour)
- Create Sequelize migrations for new models
- Add indexes
- Add foreign keys

---

## 📊 CONVERSION TEMPLATE

### Mongoose → Sequelize Conversion Rules

**Mongoose:**
```javascript
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  field: {
    type: String,
    required: true,
    unique: true
  }
}, { timestamps: true });

module.exports = mongoose.model('ModelName', schema);
```

**Sequelize:**
```javascript
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ModelName = sequelize.define('ModelName', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  field: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  }
}, {
  tableName: 'model_names',
  timestamps: true,
  underscored: true
});

module.exports = ModelName;
```

### Type Mappings

| Mongoose | Sequelize |
|----------|-----------|
| String | DataTypes.STRING(length) |
| Number | DataTypes.INTEGER or DataTypes.DECIMAL |
| Boolean | DataTypes.BOOLEAN |
| Date | DataTypes.DATE |
| ObjectId | DataTypes.UUID |
| Mixed | DataTypes.JSONB |
| Decimal128 | DataTypes.DECIMAL(36, 18) |
| Array | DataTypes.ARRAY or JSONB |

---

## 🔍 VERIFICATION CHECKLIST

After conversion, verify:

- [ ] No `require('mongoose')` anywhere in backend/models/
- [ ] No `require('mongodb')` anywhere in backend/
- [ ] All models export Sequelize models
- [ ] backend/models/index.js only has Sequelize code
- [ ] All tests pass
- [ ] Server starts without MongoDB errors
- [ ] Database migrations run successfully

---

## 🎯 EXPECTED OUTCOME

After completion:
- ✅ 100% PostgreSQL/Sequelize
- ✅ 0% MongoDB/Mongoose
- ✅ All models working
- ✅ All tests passing
- ✅ Clean dependencies

---

## ⏱️ TIME ESTIMATE

- **Total Time**: 4-5 hours
- **Priority**: Do this TODAY before anything else
- **Blocker**: This is blocking database setup and testing

---

*Created: February 9, 2026*
*Status: READY TO EXECUTE*
