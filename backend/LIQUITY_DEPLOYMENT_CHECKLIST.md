# Liquity Integration - Deployment Checklist

Use this checklist to ensure proper deployment of the Liquity integration.

## Phase 1: Installation & Setup

### Dependencies
- [ ] Install `@liquity/lib-ethers` package
  ```bash
  npm install @liquity/lib-ethers
  ```
- [ ] Verify `ethers@6` is installed
- [ ] Verify `node-cron` is installed

### Environment Configuration
- [ ] Copy `.env.example` to `.env`
- [ ] Set `ETHEREUM_RPC_URL` (Alchemy/Infura)
- [ ] Set `ETHEREUM_PRIVATE_KEY` (testnet first!)
- [ ] Set `LIQUITY_NETWORK` (sepolia/goerli for testing)
- [ ] Configure `LIQUITY_ALERTS_ENABLED`
- [ ] Set `LIQUITY_WEBHOOK_URL` (if using webhooks)
- [ ] Set `MAX_GAS_PRICE` limit

### Database Setup
- [ ] Run database sync: `npm run sync-db`
- [ ] Verify tables created:
  - `liquity_troves`
  - `liquity_transactions`
  - `liquity_stability_deposits`
- [ ] Check table indexes are created
- [ ] Verify foreign key relationships

## Phase 2: Testing (Testnet)

### Connection Tests
- [ ] Run `npm run test-liquity`
- [ ] Verify service initializes
- [ ] Confirm ETH price fetching works
- [ ] Check TCR retrieval
- [ ] Verify contract addresses are correct

### Trove Operations (Testnet)
- [ ] Open test Trove with minimum values
  - Min: 0.01 ETH collateral
  - Min: 2000 LUSD debt
- [ ] Verify Trove appears in database
- [ ] Check transaction is recorded
- [ ] Adjust Trove (add collateral)
- [ ] Adjust Trove (borrow more)
- [ ] Adjust Trove (repay debt)
- [ ] Adjust Trove (withdraw collateral)
- [ ] Close Trove
- [ ] Verify all operations recorded

### Stability Pool (Testnet)
- [ ] Deposit LUSD to Stability Pool
- [ ] Check deposit recorded in database
- [ ] Verify deposit info retrieval
- [ ] Withdraw from Stability Pool
- [ ] Confirm withdrawal recorded

### Monitoring Tests
- [ ] Run `npm run test-liquity-monitor`
- [ ] Verify monitor starts successfully
- [ ] Check periodic health checks run
- [ ] Confirm risk levels calculated correctly
- [ ] Test manual health check endpoint
- [ ] Verify alerts are generated (if CR low)
- [ ] Test webhook delivery (if configured)

### API Endpoint Tests
- [ ] Test `GET /api/liquity/status`
- [ ] Test `GET /api/liquity/price`
- [ ] Test `GET /api/liquity/tcr`
- [ ] Test `POST /api/liquity/trove/open`
- [ ] Test `GET /api/liquity/trove/:id`
- [ ] Test `POST /api/liquity/trove/:id/adjust`
- [ ] Test `POST /api/liquity/trove/:id/close`
- [ ] Test `GET /api/liquity/troves`
- [ ] Test `POST /api/liquity/stability/deposit`
- [ ] Test `GET /api/liquity/stability/deposit`
- [ ] Test `POST /api/liquity/stability/withdraw`
- [ ] Test `GET /api/liquity/transactions`

## Phase 3: Security Review

### Private Key Security
- [ ] Private key stored in environment variable
- [ ] Private key NOT in version control
- [ ] `.env` file in `.gitignore`
- [ ] Consider using hardware wallet for production
- [ ] Document key management procedures

### Gas Management
- [ ] `MAX_GAS_PRICE` set appropriately
- [ ] Gas limits configured for each operation
- [ ] Wallet has sufficient ETH for gas
- [ ] Gas cost monitoring in place

### Access Control
- [ ] All Trove endpoints require authentication
- [ ] User can only access their own Troves
- [ ] Admin endpoints properly secured
- [ ] Rate limiting configured

### Input Validation
- [ ] All inputs validated
- [ ] Minimum values enforced
- [ ] Maximum values checked
- [ ] Type checking in place
- [ ] SQL injection prevention

## Phase 4: Monitoring Setup

### Alert Configuration
- [ ] Alert thresholds configured
  - Warning: 120% CR
  - Critical: 115% CR
- [ ] Webhook URL configured (if using)
- [ ] Email alerts configured (if using)
- [ ] Test alert delivery
- [ ] Document escalation procedures

### Auto Top-Up (Optional)
- [ ] Decide if enabling auto top-up
- [ ] Set `LIQUITY_AUTO_TOPUP` appropriately
- [ ] Configure `autoTopUpThreshold` (130% recommended)
- [ ] Configure `autoTopUpTarget` (180% recommended)
- [ ] Ensure wallet has sufficient ETH
- [ ] Test auto top-up on testnet

### Monitoring Dashboard
- [ ] Set up monitoring dashboard
- [ ] Track active Troves
- [ ] Monitor collateral ratios
- [ ] Display ETH price
- [ ] Show TCR and Recovery Mode status
- [ ] Alert history visible

## Phase 5: Documentation

### Internal Documentation
- [ ] Document operational procedures
- [ ] Create runbook for common issues
- [ ] Document emergency procedures
- [ ] List key contacts
- [ ] Document backup procedures

### User Documentation
- [ ] API documentation complete
- [ ] Usage examples provided
- [ ] Error messages documented
- [ ] FAQ created
- [ ] Support channels listed

## Phase 6: Production Deployment

### Pre-Production
- [ ] All testnet tests passed
- [ ] Security review completed
- [ ] Monitoring configured
- [ ] Documentation complete
- [ ] Team trained on operations

### Production Configuration
- [ ] Change `LIQUITY_NETWORK` to `mainnet`
- [ ] Update `ETHEREUM_RPC_URL` to mainnet endpoint
- [ ] Use production private key
- [ ] Verify contract addresses (mainnet)
- [ ] Set production gas limits
- [ ] Configure production alerts

### Initial Production Tests
- [ ] Test with small amounts first
- [ ] Open minimal Trove (2000 LUSD)
- [ ] Verify all operations work
- [ ] Confirm monitoring active
- [ ] Test alert delivery
- [ ] Verify transaction recording

### Go-Live
- [ ] Start server: `npm start`
- [ ] Verify service initialized
- [ ] Check monitor running
- [ ] Confirm database connected
- [ ] Test API endpoints
- [ ] Monitor logs for errors

## Phase 7: Post-Deployment

### Daily Monitoring
- [ ] Check all active Troves
- [ ] Review collateral ratios
- [ ] Monitor ETH price trends
- [ ] Check alert history
- [ ] Review transaction logs
- [ ] Verify monitor running

### Weekly Tasks
- [ ] Analyze transaction costs
- [ ] Review Stability Pool performance
- [ ] Optimize collateral ratios
- [ ] Update risk thresholds if needed
- [ ] Review and update documentation
- [ ] Team sync on operations

### Monthly Review
- [ ] Performance analysis
- [ ] Cost optimization review
- [ ] Security audit
- [ ] Documentation updates
- [ ] Process improvements
- [ ] Disaster recovery test

## Emergency Procedures

### Low Collateral Ratio Alert
1. [ ] Verify alert is accurate
2. [ ] Check current ETH price
3. [ ] Calculate required collateral
4. [ ] Add collateral immediately
5. [ ] Verify CR improved
6. [ ] Document incident

### Critical Alert (CR < 115%)
1. [ ] IMMEDIATE ACTION REQUIRED
2. [ ] Add maximum available collateral
3. [ ] Or repay debt if possible
4. [ ] Or close Trove if necessary
5. [ ] Escalate to team lead
6. [ ] Document emergency response

### Recovery Mode (TCR < 150%)
1. [ ] Alert all Trove owners
2. [ ] Recommend increasing all CRs
3. [ ] Monitor system closely
4. [ ] Prepare for aggressive liquidations
5. [ ] Document system state

### Service Failure
1. [ ] Check server logs
2. [ ] Verify RPC endpoint
3. [ ] Check database connection
4. [ ] Restart service if needed
5. [ ] Verify monitor restarted
6. [ ] Document issue and resolution

## Rollback Procedures

### If Issues Detected
1. [ ] Stop accepting new Trove operations
2. [ ] Allow existing operations to complete
3. [ ] Stop monitoring service
4. [ ] Document all issues
5. [ ] Revert to previous version if needed
6. [ ] Investigate root cause

### Rollback Steps
1. [ ] Stop server
2. [ ] Revert code changes
3. [ ] Restore database if needed
4. [ ] Restart server
5. [ ] Verify functionality
6. [ ] Document rollback reason

## Success Criteria

### Technical
- [ ] All tests passing
- [ ] No errors in logs
- [ ] Monitoring active
- [ ] Alerts working
- [ ] Performance acceptable

### Operational
- [ ] Team trained
- [ ] Documentation complete
- [ ] Procedures documented
- [ ] Support ready
- [ ] Escalation paths clear

### Business
- [ ] User requirements met
- [ ] Risk management in place
- [ ] Compliance verified
- [ ] Costs acceptable
- [ ] Stakeholders informed

## Sign-Off

### Development Team
- [ ] Code review completed
- [ ] Tests passed
- [ ] Documentation complete
- Signed: _________________ Date: _______

### Security Team
- [ ] Security review completed
- [ ] Vulnerabilities addressed
- [ ] Access controls verified
- Signed: _________________ Date: _______

### Operations Team
- [ ] Monitoring configured
- [ ] Procedures documented
- [ ] Team trained
- Signed: _________________ Date: _______

### Product Owner
- [ ] Requirements met
- [ ] Acceptance criteria satisfied
- [ ] Ready for production
- Signed: _________________ Date: _______

---

**Deployment Status:** [ ] Not Started [ ] In Progress [ ] Complete

**Production Go-Live Date:** __________________

**Notes:**
_____________________________________________
_____________________________________________
_____________________________________________
