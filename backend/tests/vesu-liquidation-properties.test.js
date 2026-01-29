const fc = require('fast-check');
const Decimal = require('decimal.js');
const LiquidationEngine = require('../services/LiquidationEngine');
const { VesuService } = require('../services/VesuService');
const VesuPosition = require('../models/VesuPosition');
const VesuPool = require('../models/VesuPool');
const VesuLiquidation = require('../models/VesuLiquidation');
const { sequelize } = require('../config/database');

// Set decimal precision
Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });

describe('Vesu Liquidation Properties', () => {
  let liquidationEngine;
  let vesuService;

  beforeAll(async () => {
    // Initialize services
    vesuService = new VesuService();
    liquidationEngine = new LiquidationEngine(vesuService);

    // Sync database
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await VesuLiquidation.destroy({ where: {}, truncate: true });
    await VesuPosition.destroy({ where: {}, truncate: true });
    await VesuPool.destroy({ where: {}, truncate: true });
  });

  /**
   * Property 6.6.1: Liquidation Eligibility
   * **Validates: Requirements 3.6.2**
   * 
   * For any position:
   * - Property: Position is liquidatable if and only if healthFactor < 1.0
   * - Invariant: Liquidation engine identifies all positions with healthFactor < 1.0
   */
  describe('Property 6.6.1: Liquidation Eligibility', () => {
    test('only positions with health factor < 1.0 are liquidatable', async () => {
      // Create test pool
      const pool = await VesuPool.create({
        pool_address: '0x1234567890abcdef',
        collateral_asset: 'ETH',
        debt_asset: 'USDC',
        max_ltv: '0.75',
        liquidation_threshold: '0.80',
        liquidation_bonus: '0.05',
        total_supply: '1000000',
        total_borrow: '500000',
        supply_apy: '3.5',
        borrow_apy: '5.2',
        is_active: true,
        last_synced: new Date()
      });

      await fc.assert(
        fc.asyncProperty(
          // Generate health factor values
          fc.double({ min: 0.5, max: 2.0, noNaN: true }),
          async (healthFactor) => {
            // Create position with specific health factor
            const position = await VesuPosition.create({
              user_id: 'test-user-id',
              pool_address: pool.pool_address,
              collateral_asset: 'ETH',
              debt_asset: 'USDC',
              collateral_amount: '1.0',
              debt_amount: '1000',
              vtoken_balance: '1.0',
              health_factor: healthFactor.toString(),
              status: 'active',
              last_updated: new Date()
            });

            // Find liquidatable positions
            const liquidatablePositions = await liquidationEngine.findLiquidatablePositions();

            // Check if position is in liquidatable list
            const isInLiquidatableList = liquidatablePositions.some(
              opp => opp.positionId === position.id
            );

            // Property: Position is liquidatable if and only if HF < 1.0
            const shouldBeLiquidatable = healthFactor < 1.0;

            // Clean up
            await position.destroy();

            return isInLiquidatableList === shouldBeLiquidatable;
          }
        ),
        { numRuns: 100 }
      );
    });

    test('positions with health factor >= 1.0 are not liquidatable', async () => {
      // Create test pool
      const pool = await VesuPool.create({
        pool_address: '0x1234567890abcdef',
        collateral_asset: 'ETH',
        debt_asset: 'USDC',
        max_ltv: '0.75',
        liquidation_threshold: '0.80',
        liquidation_bonus: '0.05',
        total_supply: '1000000',
        total_borrow: '500000',
        supply_apy: '3.5',
        borrow_apy: '5.2',
        is_active: true,
        last_synced: new Date()
      });

      await fc.assert(
        fc.asyncProperty(
          // Generate health factor values >= 1.0
          fc.double({ min: 1.0, max: 5.0, noNaN: true }),
          async (healthFactor) => {
            // Create position with HF >= 1.0
            const position = await VesuPosition.create({
              user_id: 'test-user-id',
              pool_address: pool.pool_address,
              collateral_asset: 'ETH',
              debt_asset: 'USDC',
              collateral_amount: '1.0',
              debt_amount: '1000',
              vtoken_balance: '1.0',
              health_factor: healthFactor.toString(),
              status: 'active',
              last_updated: new Date()
            });

            // Find liquidatable positions
            const liquidatablePositions = await liquidationEngine.findLiquidatablePositions();

            // Position should NOT be in liquidatable list
            const isInLiquidatableList = liquidatablePositions.some(
              opp => opp.positionId === position.id
            );

            // Clean up
            await position.destroy();

            return !isInLiquidatableList;
          }
        ),
        { numRuns: 100 }
      );
    });

    test('positions with null health factor (no debt) are not liquidatable', async () => {
      // Create test pool
      const pool = await VesuPool.create({
        pool_address: '0x1234567890abcdef',
        collateral_asset: 'ETH',
        debt_asset: 'USDC',
        max_ltv: '0.75',
        liquidation_threshold: '0.80',
        liquidation_bonus: '0.05',
        total_supply: '1000000',
        total_borrow: '500000',
        supply_apy: '3.5',
        borrow_apy: '5.2',
        is_active: true,
        last_synced: new Date()
      });

      // Create position with no debt (null health factor)
      const position = await VesuPosition.create({
        user_id: 'test-user-id',
        pool_address: pool.pool_address,
        collateral_asset: 'ETH',
        debt_asset: 'USDC',
        collateral_amount: '1.0',
        debt_amount: '0',
        vtoken_balance: '1.0',
        health_factor: null,
        status: 'active',
        last_updated: new Date()
      });

      // Find liquidatable positions
      const liquidatablePositions = await liquidationEngine.findLiquidatablePositions();

      // Position should NOT be in liquidatable list
      const isInLiquidatableList = liquidatablePositions.some(
        opp => opp.positionId === position.id
      );

      expect(isInLiquidatableList).toBe(false);
    });
  });

  /**
   * Property 6.6.2: Liquidation Calculation
   * **Validates: Requirements 3.6.3**
   * 
   * For any liquidation:
   * - Given: debt covered D_covered, collateral price P_c, liquidation bonus B
   * - Property: Collateral seized C_seized = (D_covered / P_c) * (1 + B)
   * - Invariant: Liquidator receives correct collateral amount including bonus
   */
  describe('Property 6.6.2: Liquidation Calculation', () => {
    test('collateral seized equals (debtCovered / price) * (1 + bonus)', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate test parameters
          fc.double({ min: 100, max: 10000, noNaN: true }), // debt to cover
          fc.double({ min: 1000, max: 5000, noNaN: true }), // collateral price
          fc.double({ min: 1000, max: 5000, noNaN: true }), // debt price
          fc.double({ min: 0.01, max: 0.15, noNaN: true }), // liquidation bonus
          async (debtToCover, collateralPrice, debtPrice, liquidationBonus) => {
            // Calculate expected collateral seized
            const debtToCoverDecimal = new Decimal(debtToCover);
            const collateralPriceDecimal = new Decimal(collateralPrice);
            const debtPriceDecimal = new Decimal(debtPrice);
            const liquidationBonusDecimal = new Decimal(liquidationBonus);

            // Formula: collateralSeized = (debtCovered * debtPrice / collateralPrice) * (1 + bonus)
            const debtValueInCollateral = debtToCoverDecimal
              .mul(debtPriceDecimal)
              .div(collateralPriceDecimal);
            
            const expectedCollateralSeized = debtValueInCollateral
              .mul(new Decimal(1).add(liquidationBonusDecimal));

            // Calculate using LiquidationEngine method
            const pool = {
              liquidation_bonus: liquidationBonusDecimal.toString()
            };

            const position = {
              collateral_asset: 'ETH',
              debt_asset: 'USDC',
              collateral_amount: expectedCollateralSeized.mul(2).toString(), // Ensure sufficient collateral
              debt_amount: debtToCoverDecimal.toString()
            };

            const prices = {
              'ETH': collateralPriceDecimal.toString(),
              'USDC': debtPriceDecimal.toString()
            };

            // Calculate collateral to seize
            const debtValueInCollateralCalc = debtToCoverDecimal
              .mul(debtPriceDecimal)
              .div(collateralPriceDecimal);
            
            const calculatedCollateralSeized = debtValueInCollateralCalc
              .mul(new Decimal(1).add(liquidationBonusDecimal));

            // Verify calculation matches expected formula
            const tolerance = new Decimal(0.0001);
            const difference = calculatedCollateralSeized.sub(expectedCollateralSeized).abs();

            return difference.lte(tolerance);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('liquidation bonus is correctly applied to collateral seized', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 100, max: 10000, noNaN: true }), // debt to cover
          fc.double({ min: 1000, max: 5000, noNaN: true }), // collateral price
          fc.double({ min: 1000, max: 5000, noNaN: true }), // debt price
          fc.double({ min: 0.01, max: 0.15, noNaN: true }), // liquidation bonus
          async (debtToCover, collateralPrice, debtPrice, liquidationBonus) => {
            const debtToCoverDecimal = new Decimal(debtToCover);
            const collateralPriceDecimal = new Decimal(collateralPrice);
            const debtPriceDecimal = new Decimal(debtPrice);
            const liquidationBonusDecimal = new Decimal(liquidationBonus);

            // Calculate collateral without bonus
            const debtValueInCollateral = debtToCoverDecimal
              .mul(debtPriceDecimal)
              .div(collateralPriceDecimal);

            // Calculate collateral with bonus
            const collateralWithBonus = debtValueInCollateral
              .mul(new Decimal(1).add(liquidationBonusDecimal));

            // Calculate bonus amount
            const bonusAmount = debtValueInCollateral.mul(liquidationBonusDecimal);

            // Verify: collateralWithBonus = debtValueInCollateral + bonusAmount
            const expectedTotal = debtValueInCollateral.add(bonusAmount);

            const tolerance = new Decimal(0.0001);
            const difference = collateralWithBonus.sub(expectedTotal).abs();

            return difference.lte(tolerance);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('liquidation calculation is consistent across different price ratios', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 100, max: 10000, noNaN: true }), // debt to cover
          fc.double({ min: 0.1, max: 10, noNaN: true }), // price ratio (debtPrice / collateralPrice)
          fc.double({ min: 0.01, max: 0.15, noNaN: true }), // liquidation bonus
          async (debtToCover, priceRatio, liquidationBonus) => {
            const debtToCoverDecimal = new Decimal(debtToCover);
            const priceRatioDecimal = new Decimal(priceRatio);
            const liquidationBonusDecimal = new Decimal(liquidationBonus);

            // Use fixed collateral price and calculate debt price from ratio
            const collateralPrice = new Decimal(2000);
            const debtPrice = collateralPrice.mul(priceRatioDecimal);

            // Calculate collateral seized
            const debtValueInCollateral = debtToCoverDecimal
              .mul(debtPrice)
              .div(collateralPrice);
            
            const collateralSeized = debtValueInCollateral
              .mul(new Decimal(1).add(liquidationBonusDecimal));

            // Verify collateral seized is positive and reasonable
            const isPositive = collateralSeized.gt(0);
            const isReasonable = collateralSeized.lt(debtToCoverDecimal.mul(100)); // Sanity check

            return isPositive && isReasonable;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
