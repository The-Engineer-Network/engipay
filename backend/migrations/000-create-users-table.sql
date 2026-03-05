-- Migration: Create Users table (base table)
-- This must run before 001-create-new-models.sql

CREATE TABLE IF NOT EXISTS "User" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE,
  email VARCHAR(255) UNIQUE,
  password VARCHAR(255),
  wallet_address VARCHAR(100) UNIQUE,
  wallet_type VARCHAR(50) CHECK (wallet_type IN ('metamask', 'argent', 'braavos', 'xverse', 'walletconnect')),
  first_name VARCHAR(50),
  last_name VARCHAR(50),
  avatar_url TEXT,
  bio TEXT CHECK (LENGTH(bio) <= 500),
  kyc_status VARCHAR(20) DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'in_review', 'approved', 'rejected', 'not_required')),
  kyc_verified_at TIMESTAMP WITH TIME ZONE,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT,
  settings JSONB DEFAULT '{"notifications":{"email":true,"push":true,"sms":false,"marketing":false},"currency":"USD","language":"en","theme":"auto","timezone":"UTC"}',
  is_active BOOLEAN DEFAULT TRUE,
  is_email_verified BOOLEAN DEFAULT FALSE,
  email_verified_at TIMESTAMP WITH TIME ZONE,
  last_login TIMESTAMP WITH TIME ZONE,
  login_count INTEGER DEFAULT 0,
  risk_score INTEGER DEFAULT 50 CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level VARCHAR(20) DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high', 'very_high')),
  referral_code VARCHAR(50) UNIQUE,
  referral_count INTEGER DEFAULT 0,
  referred_by UUID REFERENCES "User"(id),
  social_links JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_wallet_address ON "User"(wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_email ON "User"(email);
CREATE INDEX IF NOT EXISTS idx_user_username ON "User"(username);
CREATE INDEX IF NOT EXISTS idx_user_kyc_status ON "User"(kyc_status);
CREATE INDEX IF NOT EXISTS idx_user_created_at ON "User"(created_at);
CREATE INDEX IF NOT EXISTS idx_user_last_login ON "User"(last_login);
CREATE INDEX IF NOT EXISTS idx_user_deleted_at ON "User"(deleted_at);

-- Create lowercase alias for compatibility
CREATE TABLE IF NOT EXISTS users (
  LIKE "User" INCLUDING ALL
);

-- Create trigger to sync data between User and users tables
CREATE OR REPLACE FUNCTION sync_user_tables()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO users SELECT NEW.*;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE users SET 
      username = NEW.username,
      email = NEW.email,
      password = NEW.password,
      wallet_address = NEW.wallet_address,
      wallet_type = NEW.wallet_type,
      first_name = NEW.first_name,
      last_name = NEW.last_name,
      avatar_url = NEW.avatar_url,
      bio = NEW.bio,
      kyc_status = NEW.kyc_status,
      kyc_verified_at = NEW.kyc_verified_at,
      two_factor_enabled = NEW.two_factor_enabled,
      two_factor_secret = NEW.two_factor_secret,
      settings = NEW.settings,
      is_active = NEW.is_active,
      is_email_verified = NEW.is_email_verified,
      email_verified_at = NEW.email_verified_at,
      last_login = NEW.last_login,
      login_count = NEW.login_count,
      risk_score = NEW.risk_score,
      risk_level = NEW.risk_level,
      referral_code = NEW.referral_code,
      referral_count = NEW.referral_count,
      referred_by = NEW.referred_by,
      social_links = NEW.social_links,
      updated_at = NEW.updated_at,
      deleted_at = NEW.deleted_at
    WHERE id = NEW.id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM users WHERE id = OLD.id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_user_insert ON "User";
CREATE TRIGGER sync_user_insert
AFTER INSERT ON "User"
FOR EACH ROW EXECUTE FUNCTION sync_user_tables();

DROP TRIGGER IF EXISTS sync_user_update ON "User";
CREATE TRIGGER sync_user_update
AFTER UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION sync_user_tables();

DROP TRIGGER IF EXISTS sync_user_delete ON "User";
CREATE TRIGGER sync_user_delete
AFTER DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION sync_user_tables();
