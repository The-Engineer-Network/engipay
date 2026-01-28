const fc = require('fast-check');
const Decimal = require('decimal.js');
const { VesuService } = require('../services/VesuService');

/**
 * Property-Based Tests for Vesu Position Management
 * 
 * These tests validate correctness properties for position management operations
 * as defined in the design document (Section 6.5)
 */

describe('Vesu Position Management - Property-Based Tests', () => {
  let vesuService;

  beforeAll(() => {
    // Set decimal precision for tests
    Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });
  });

  beforeEach(() => {
    // Create mock dependencies
    const mockContractManager = {
      getVTokenExchangeRateForPool: jest.fn().mockResolvedValue('1000000000000000000'),
      getVTokenBalance: jest.fn().mockResolvedValue('0'),
      provider: {}
    };

    const mockOracleService = {
      getPrice: jest.fn().mockResolvedValue('2500'),
      getPrices: jest.fn().mockResolvedValue({ ETH: '2500', USDC: '1' })
    };

    const mockTransactionManager = {
      executeSupply: jest.fn().mockResolvedValue('0x123'),
      executeBorrow: jest.fn().mockResolvedValue('0x456'),
      provider: {}
    };

    // Initialize VesuService with mocked dependencies
    vesuService = new VesuService(
      mockContractManager,
      mockOracleService,
      mockTransactionManager
    );
  });

  /**
   * Property 6.5.1: Health Factor Formula
   * **Validates: Requirements 3.5.3**
   * 
   * For any position:
   * - Given: risk-adjusted collateral value `C_adj`, debt value `D`
   * - Property: `healthFactor = C_adj / D` when `D > 0`, `healthFactor = ∞` when `D == 0`
   * - Invariant: Formula is applied consistently across all calculations
   */
  describe('Property 6.5.1: Health Factor Formula', () => {
    test('health factor should equal (collateral * liquidationThreshold * price) / (debt * price)', () => {
      fc.assert(
        fc.property(
          // Generate collateral amounts between 0.1 and 1000
          fc.double({ min: 0.1, max: 1000, noNaN: true }),
          // Generate debt amounts between 0.1 and 10000
          fc.double({ min: 0.1, max: 10000, noNaN: true }),
          // Generate collateral prices between 100 and 5000
          fc.double({ min: 100, max: 5000, noNaN: true }),
          // Generate debt prices between 0.5 and 2
          fc.double({ min: 0.5, max: 2, noNaN: true }),
          // Generate liquidation thresholds between 0.7 and 0.9
          fc.double({ min: 0.7, max: 0.9, noNaN: true }),
          (collateralAmount, debtAmount, collateralPrice, debtPrice, liquidationThreshold) => {
            // Create position object
            const position = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: debtAmount.toString()
            };

            // Create prices object
            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Mock the pool config to return our liquidation threshold
            const originalGetPoolConfig = require('../config/vesu.config').getPoolConfig;
            require('../config/vesu.config').getPoolConfig = jest.fn().mockReturnValue({
              liquidationThreshold: liquidationThreshold.toString()
            });

            // Calculate health factor using service
            const healthFactor = vesuService.calculateHealthFactor(position, prices);

            // Restore original function
            require('../config/vesu.config').getPoolConfig = originalGetPoolConfig;

            // Calculate expected health factor manually
            const collateralDecimal = new Decimal(collateralAmount);
            const debtDecimal = new Decimal(debtAmount);
            const collateralPriceDecimal = new Decimal(collateralPrice);
            const debtPriceDecimal = new Decimal(debtPrice);
            const liquidationThresholdDecimal = new Decimal(liquidationThreshold);

            const collateralValue = collateralDecimal.mul(collateralPriceDecimal);
            const riskAdjustedCollateralValue = collateralValue.mul(liquidationThresholdDecimal);
            const debtValue = debtDecimal.mul(debtPriceDecimal);
            const expectedHealthFactor = riskAdjustedCollateralValue.div(debtValue);

            // Property: Calculated HF should match formula
            const tolerance = expectedHealthFactor.mul(0.000001);
            const difference = healthFactor.sub(expectedHealthFactor).abs();

            const isValid = difference.lte(tolerance);

            if (!isValid) {
              console.log('Health factor formula violation:', {
                collateralAmount,
                debtAmount,
                collateralPrice,
                debtPrice,
                liquidationThreshold,
                calculatedHF: healthFactor.toString(),
                expectedHF: expectedHealthFactor.toString(),
                difference: difference.toString()
              });
            }

            return isValid;
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('health factor should be null when debt is zero', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.1, max: 1000, noNaN: true }),
          fc.double({ min: 100, max: 5000, noNaN: true }),
          (collateralAmount, collateralPrice) => {
            const position = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: '0'
            };

            const prices = {
              ETH: collateralPrice.toString(),
              USDC: '1'
            };

            const healthFactor = vesuService.calculateHealthFactor(position, prices);

            // Property: HF should be null (infinite) when debt is zero
            return healthFactor === null;
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('health factor should increase when collateral increases', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 0.1, max: 10, noNaN: true }), // collateral increase
          fc.double({ min: 100, max: 5000, noNaN: true }),
          (collateralAmount, debtAmount, collateralIncrease, collateralPrice) => {
            const position1 = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: debtAmount.toString()
            };

            const position2 = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: (collateralAmount + collateralIncrease).toString(),
              debtAmount: debtAmount.toString()
            };

            const prices = {
              ETH: collateralPrice.toString(),
              USDC: '1'
            };

            const hf1 = vesuService.calculateHealthFactor(position1, prices);
            const hf2 = vesuService.calculateHealthFactor(position2, prices);

            // Property: HF should increase when collateral increases
            return hf2.gt(hf1);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('health factor should decrease when debt increases', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 1, max: 50, noNaN: true }),
          fc.double({ min: 0.1, max: 10, noNaN: true }), // debt increase
          fc.double({ min: 100, max: 5000, noNaN: true }),
          (collateralAmount, debtAmount, debtIncrease, collateralPrice) => {
            const position1 = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: debtAmount.toString()
            };

            const position2 = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: (debtAmount + debtIncrease).toString()
            };

            const prices = {
              ETH: collateralPrice.toString(),
              USDC: '1'
            };

            const hf1 = vesuService.calculateHealthFactor(position1, prices);
            const hf2 = vesuService.calculateHealthFactor(position2, prices);

            // Property: HF should decrease when debt increases
            return hf2.lt(hf1);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });
  });
});
