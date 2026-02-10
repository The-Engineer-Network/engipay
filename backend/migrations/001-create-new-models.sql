-- Migration: Add new models (Wallet, Notification, Swap, SwapQuote, Reward, DeFiPosition, Analytics, YieldFarm)
-- Date: 2026-02-09

-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(255) NOT NULL UNIQUE,
  wallet_type VARCHAR(50) NOT NULL CHECK (wallet_type IN ('metamask', 'argent', 'braavos', 'xverse', 'other')),
  chain VARCHAR(50) NOT NULL CHECK (chain IN ('ethereum', 'starknet', 'bitcoin')),
  is_primary BOOLEAN DEFAULT FALSE,
  nickname VARCHAR(50),
  last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_address ON wallets(wallet_address);
CREATE INDEX idx_wallets_user_primary ON wallets(user_id, is_primary);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('transaction', 'swap', 'defi', 'price_alert', 'system', 'security')),
  title VARCHAR(200) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  data JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP WITH TIME ZONE,
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  action_url VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_type_created ON notifications(type, created_at DESC);

-- Swaps table
CREATE TABLE IF NOT EXISTS swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_token VARCHAR(50) NOT NULL CHECK (from_token IN ('BTC', 'ETH', 'STRK', 'USDT', 'USDC')),
  to_token VARCHAR(50) NOT NULL CHECK (to_token IN ('BTC', 'ETH', 'STRK', 'USDT', 'USDC')),
  amount DECIMAL(36, 18) NOT NULL,
  expected_output DECIMAL(36, 18) NOT NULL,
  actual_output DECIMAL(36, 18),
  fee DECIMAL(36, 18) DEFAULT 0,
  slippage DECIMAL(5, 2) DEFAULT 0.5,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  tx_hash VARCHAR(255) NOT NULL UNIQUE,
  blockchain_tx_hash VARCHAR(255),
  atomiq_swap_id VARCHAR(255) NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_swaps_user_id ON swaps(user_id);
CREATE INDEX idx_swaps_tx_hash ON swaps(tx_hash);
CREATE INDEX idx_swaps_status ON swaps(status);
CREATE INDEX idx_swaps_user_created ON swaps(user_id, created_at DESC);

-- Swap Quotes table
CREATE TABLE IF NOT EXISTS swap_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_token VARCHAR(50) NOT NULL,
  to_token VARCHAR(50) NOT NULL,
  amount DECIMAL(36, 18) NOT NULL,
  quote JSONB,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_swap_quotes_expires ON swap_quotes(expires_at);

-- Rewards table
CREATE TABLE IF NOT EXISTS rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id VARCHAR(255) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id UUID,
  protocol VARCHAR(50) NOT NULL CHECK (protocol IN ('vesu', 'zkLend', 'aave', 'compound', 'trove', 'other')),
  type VARCHAR(50) NOT NULL CHECK (type IN ('staking_reward', 'farming_reward', 'trading_fee', 'liquidity_mining', 'governance', 'airdrop', 'referral', 'bonus', 'other')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'claimable', 'claimed', 'expired', 'forfeited')),
  token_symbol VARCHAR(50) NOT NULL,
  token_name VARCHAR(100),
  token_address VARCHAR(255),
  amount DECIMAL(36, 18) NOT NULL,
  amount_value_usd DECIMAL(20, 2),
  claimed_amount DECIMAL(36, 18),
  claimed_at TIMESTAMP WITH TIME ZONE,
  claim_tx_hash VARCHAR(255),
  network VARCHAR(50) NOT NULL CHECK (network IN ('ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bitcoin')),
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  apy DECIMAL(10, 4),
  expires_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_rewards_user_id ON rewards(user_id);
CREATE INDEX idx_rewards_user_status ON rewards(user_id, status);
CREATE INDEX idx_rewards_position ON rewards(position_id);
CREATE INDEX idx_rewards_protocol_type ON rewards(protocol, type);
CREATE INDEX idx_rewards_expires ON rewards(expires_at);

-- DeFi Positions table
CREATE TABLE IF NOT EXISTS defi_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id VARCHAR(255) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  protocol VARCHAR(50) NOT NULL CHECK (protocol IN ('vesu', 'zkLend', 'aave', 'compound', 'uniswap', 'sushiswap', 'curve', 'yearn', 'convex', 'lido', 'rocketpool', 'makerdao', 'other')),
  protocol_name VARCHAR(100),
  type VARCHAR(50) NOT NULL CHECK (type IN ('supply', 'borrow', 'liquidity', 'staking', 'farming', 'vault', 'cdp', 'derivative')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'liquidating', 'liquidated', 'failed')),
  assets JSONB DEFAULT '[]',
  principal_amount DECIMAL(36, 18),
  principal_value_usd DECIMAL(20, 2),
  current_amount DECIMAL(36, 18),
  current_value_usd DECIMAL(20, 2),
  apy DECIMAL(10, 4),
  debt_amount DECIMAL(36, 18),
  debt_value_usd DECIMAL(20, 2),
  health_factor DECIMAL(10, 4),
  liquidation_threshold DECIMAL(5, 2),
  network VARCHAR(50) NOT NULL CHECK (network IN ('ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bitcoin')),
  protocol_data JSONB DEFAULT '{}',
  performance JSONB DEFAULT '{}',
  closed_at TIMESTAMP WITH TIME ZONE,
  last_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_defi_positions_user_id ON defi_positions(user_id);
CREATE INDEX idx_defi_positions_user_status ON defi_positions(user_id, status);
CREATE INDEX idx_defi_positions_protocol_type ON defi_positions(protocol, type);
CREATE INDEX idx_defi_positions_network_protocol ON defi_positions(network, protocol);
CREATE INDEX idx_defi_positions_health ON defi_positions(health_factor);

-- Analytics table
CREATE TABLE IF NOT EXISTS analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analytics_id VARCHAR(255) NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('user_activity', 'transaction_volume', 'defi_performance', 'portfolio_performance', 'system_usage', 'error_tracking', 'conversion_funnel', 'retention_metrics', 'revenue_metrics', 'geographic_usage', 'device_analytics', 'feature_usage', 'other')),
  period VARCHAR(20) NOT NULL CHECK (period IN ('minute', 'hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  metrics JSONB DEFAULT '{}',
  aggregation_level VARCHAR(20) DEFAULT 'global' CHECK (aggregation_level IN ('user', 'global', 'protocol', 'network', 'feature')),
  filters JSONB DEFAULT '{}',
  data_quality JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_analytics_type_period_dates ON analytics(type, period, start_date, end_date);
CREATE INDEX idx_analytics_user_type_created ON analytics(user_id, type, created_at DESC);
CREATE INDEX idx_analytics_aggregation_type ON analytics(aggregation_level, type);
CREATE INDEX idx_analytics_expires ON analytics(expires_at);

-- Yield Farms table
CREATE TABLE IF NOT EXISTS yield_farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id VARCHAR(255) NOT NULL UNIQUE,
  protocol VARCHAR(50) NOT NULL CHECK (protocol IN ('uniswap', 'sushiswap', 'pancakeswap', 'curve', 'balancer', 'yearn', 'convex', 'compound', 'aave', 'vesu', 'zkLend', 'other')),
  protocol_name VARCHAR(100),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  type VARCHAR(50) NOT NULL CHECK (type IN ('liquidity_pool', 'single_stake', 'dual_farm', 'vault', 'auto_compound', 'leveraged', 'other')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deprecated', 'paused')),
  network VARCHAR(50) NOT NULL CHECK (network IN ('ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bsc', 'avalanche')),
  farm_contract_address VARCHAR(255) NOT NULL,
  staking_token JSONB DEFAULT '{}',
  reward_tokens JSONB DEFAULT '[]',
  tvl DECIMAL(20, 2) DEFAULT 0,
  total_staked DECIMAL(36, 18) DEFAULT 0,
  apy DECIMAL(10, 4),
  base_apy DECIMAL(10, 4),
  reward_apy DECIMAL(10, 4),
  risk_level VARCHAR(20) DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high', 'very_high')),
  min_stake_amount DECIMAL(36, 18),
  lock_period_days INTEGER,
  total_stakers INTEGER DEFAULT 0,
  tags TEXT[],
  metadata JSONB DEFAULT '{}',
  ends_at TIMESTAMP WITH TIME ZONE,
  last_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_yield_farms_protocol_network ON yield_farms(protocol, network);
CREATE INDEX idx_yield_farms_type_status ON yield_farms(type, status);
CREATE INDEX idx_yield_farms_tvl ON yield_farms(tvl DESC);
CREATE INDEX idx_yield_farms_apy ON yield_farms(apy DESC);
CREATE INDEX idx_yield_farms_contract ON yield_farms(farm_contract_address);
