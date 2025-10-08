# EngiPay PostgreSQL Database Setup Guide

This guide will help you set up PostgreSQL database for EngiPay backend.

## 📋 Prerequisites

- **PostgreSQL 12+** installed and running
- **pgAdmin** (recommended for database management)
- **Node.js 16+** installed
- **npm** or **yarn** package manager

## 🚀 Quick Setup

### 1. Install PostgreSQL

**Windows:**
```bash
# Download and install from: https://www.postgresql.org/download/windows/
# Or use chocolatey: choco install postgresql
```

**macOS:**
```bash
# Using Homebrew
brew install postgresql
brew services start postgresql

# Or download from: https://www.postgresql.org/download/macosx/
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 2. Install pgAdmin (Optional but Recommended)

Download from: https://www.pgadmin.org/download/

### 3. Configure Environment Variables

Update your `.env.local` file with PostgreSQL settings:

```env
# PostgreSQL Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=engipay_db
DB_USER=engipay_user
DB_PASSWORD=your_secure_password_here
DB_SSL=false

# Database Pool Settings
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_POOL_IDLE=10000
DB_POOL_ACQUIRE=30000

# Alternative DATABASE_URL format
DATABASE_URL=postgresql://engipay_user:your_secure_password_here@localhost:5432/engipay_db

# Setup credentials (for database creation - remove in production)
DB_SETUP_USER=postgres
DB_SETUP_PASSWORD=your_postgres_superuser_password
```

### 4. Run Database Setup Script

```bash
cd backend
npm run setup-db
```

This script will:
- ✅ Create the `engipay_db` database
- ✅ Create the `engipay_user` database user
- ✅ Grant necessary privileges
- ✅ Create required PostgreSQL extensions

### 5. Verify Setup

```bash
# Test database connection
npm run sync-db

# This will create all tables based on your Sequelize models
```

## 🔧 Manual Database Setup (Alternative)

If you prefer to set up the database manually:

### Using pgAdmin:

1. **Open pgAdmin** and connect to your PostgreSQL server
2. **Create Database:**
   - Right-click "Databases" → "Create" → "Database"
   - Name: `engipay_db`
   - Owner: `postgres` (or your superuser)

3. **Create User:**
   - Right-click "Login/Group Roles" → "Create" → "Login/Group Role"
   - Name: `engipay_user`
   - Password: `your_secure_password_here`
   - Privileges: Check "Can login?" and "Create databases?"

4. **Grant Privileges:**
   - Right-click database → "Properties" → "Security" tab
   - Add `engipay_user` with all privileges

### Using Command Line:

```bash
# Connect to PostgreSQL as superuser
psql -U postgres

# Create database and user
CREATE DATABASE engipay_db;
CREATE USER engipay_user WITH PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE engipay_db TO engipay_user;

# Create extensions (connect to engipay_db first)
\c engipay_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

# Exit
\q
```

## 📊 Database Schema

EngiPay uses the following main tables:

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **users** | User accounts | id, email, wallet_address, kyc_status |
| **transactions** | Payment transactions | transaction_id, user_id, amount, status |
| **portfolios** | Asset portfolios | user_id, total_value_usd, assets |
| **wallets** | Connected wallets | user_id, address, type, balance |
| **defi_positions** | DeFi positions | user_id, protocol, type, value_usd |
| **yield_farms** | Farming opportunities | protocol, tvl, apy, reward_tokens |
| **rewards** | Claimable rewards | user_id, amount, status, token_symbol |
| **notifications** | User notifications | user_id, type, title, status |
| **analytics** | Usage analytics | type, metrics, date_range |

## 🔄 Database Operations

### Sync Database (Create/Update Tables)

```bash
npm run sync-db
```

### Reset Database (Drop and Recreate)

```bash
npm run reset-db
```

### Backup Database

```bash
pg_dump -U engipay_user -h localhost engipay_db > engipay_backup.sql
```

### Restore Database

```bash
psql -U engipay_user -h localhost engipay_db < engipay_backup.sql
```

## 🔒 Security Best Practices

### 1. Strong Passwords
- Use complex passwords for database users
- Change default passwords in production
- Use password managers for credential storage

### 2. Connection Security
```env
# Enable SSL in production
DB_SSL=true

# Use connection pooling
DB_POOL_MAX=20
DB_POOL_MIN=5
```

### 3. Network Security
- Restrict database access to application servers only
- Use VPN for remote access
- Implement firewall rules

### 4. Backup Strategy
- Regular automated backups
- Test backup restoration
- Store backups securely (encrypted)
- Implement point-in-time recovery

## 🚨 Troubleshooting

### Connection Issues

**Error: `connect ECONNREFUSED 127.0.0.1:5432`**
- PostgreSQL service is not running
- Check: `sudo systemctl status postgresql` (Linux)
- Start: `sudo systemctl start postgresql`

**Error: `password authentication failed for user`**
- Wrong password in `.env` file
- User doesn't exist in database
- Run setup script again

### Permission Issues

**Error: `permission denied for database`**
- User doesn't have proper privileges
- Run: `GRANT ALL PRIVILEGES ON DATABASE engipay_db TO engipay_user;`

### Extension Issues

**Error: `extension "uuid-ossp" does not exist`**
- Extensions not installed
- Run setup script or manually create extensions

## 📈 Performance Optimization

### Connection Pooling
```env
DB_POOL_MAX=20
DB_POOL_MIN=5
DB_POOL_IDLE=10000
DB_POOL_ACQUIRE=30000
```

### Indexing Strategy
- Primary keys automatically indexed
- Foreign keys indexed for joins
- Frequently queried fields indexed
- Composite indexes for complex queries

### Query Optimization
- Use `EXPLAIN ANALYZE` to optimize slow queries
- Implement proper pagination
- Use database views for complex aggregations
- Cache frequently accessed data

## 🔄 Migration Strategy

For production deployments:

1. **Development**: Use `sync-db` for automatic schema updates
2. **Staging**: Use migration files for controlled updates
3. **Production**: Use migration files with rollback capability

## 📞 Support

For database-related issues:
- Check PostgreSQL logs: `/var/log/postgresql/`
- Use pgAdmin for visual database inspection
- Monitor connection pool usage
- Implement proper error handling in application code

## 🎯 Next Steps

After database setup:
1. ✅ Start the backend server: `npm run dev`
2. ✅ Test API endpoints with Postman/Insomnia
3. ✅ Run database migrations if needed
4. ✅ Set up monitoring and alerts
5. ✅ Implement backup automation

Your EngiPay database is now ready for production use! 🚀