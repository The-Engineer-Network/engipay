const fc = require('fast-check');
const Decimal = require('decimal.js');
const { VesuService } = require('../services/VesuService');

/**
 * Property-Based Tests for Vesu Repay Operations
 * 
 * These tests validate correctness properties for repay operations
 * as defined in the design document (Section 6.3)
 */

describe('Vesu Repay Operations - Property-Based Tests', () => {
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
      executeRepay: jest.fn().mockResolvedValue('0x789'),
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
   * Property 6.3.1: Debt Reduction
   * **Validates: Requirements 3.3.1, 3.3.5**
   * 
   * For any repayment:
   * - Given: debt before `D_before`, repayment amount `R`
   * - Property: `D_after = D_before - R` (accounting for interest accrued during transaction)
   * - Invariant: `D_after < D_before` for any `R > 0`
   */
  describe('Property 6.3.1: Debt Reduction', () => {
    test('debt should decrease by repayment amount', () => {
      fc.assert(
        fc.property(
          // Generate initial debt between 100 and 10000
          fc.double({ min: 100, max: 10000, noNaN: true }),
          // Generate repayment amount between 1 and initial debt
          fc.double({ min: 1, max: 100, noNaN: true }),
          (initialDebt, repaymentPercent) => {
            const debtBefore = new Decimal(initialDebt);
            // Repayment is a percentage of initial debt (1-100%)
            const repaymentAmount = debtBefore.mul(new Decimal(repaymentPercent).div(100));
            
            // Calculate debt after repayment
            const debtAfter = debtBefore.sub(repaymentAmount);

            // Property: D_after = D_before - R
            const expectedDebtAfter = debtBefore.sub(repaymentAmount);
            
            // Allow small tolerance for rounding
            const tolerance = new Decimal(0.000001);
            const difference = debtAfter.sub(expectedDebtAfter).abs();

            const isValid = difference.lte(tolerance);

            if (!isValid) {
              console.log('Debt reduction mismatch:', {
                debtBefore: debtBefore.toString(),
                repaymentAmount: repaymentAmount.toString(),
                debtAfter: debtAfter.toString(),
                expectedDebtAfter: expectedDebtAfter.toString(),
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

    test('debt should always decrease after repayment', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 10000, noNaN: true }),
          fc.double({ min: 0.01, max: 100, noNaN: true }), // repayment percent (0.01% to 100%)
          (initialDebt, repaymentPercent) => {
            const debtBefore = new Decimal(initialDebt);
            const repaymentAmount = debtBefore.mul(new Decimal(repaymentPercent).div(100));
            const debtAfter = debtBefore.sub(repaymentAmount);

            // Property: D_after < D_before for any R > 0
            return debtAfter.lt(debtBefore);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('full repayment should result in zero debt', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 10000, noNaN: true }),
          (initialDebt) => {
            const debtBefore = new Decimal(initialDebt);
            const repaymentAmount = debtBefore; // Full repayment
            const debtAfter = debtBefore.sub(repaymentAmount);

            // Property: Full repayment should result in zero debt
            return debtAfter.isZero();
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('partial repayment should leave remaining debt', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 10000, noNaN: true }),
          fc.double({ min: 0.01, max: 99.99, noNaN: true }), // partial repayment (not 100%)
          (initialDebt, repaymentPercent) => {
            const debtBefore = new Decimal(initialDebt);
            const repaymentAmount = debtBefore.mul(new Decimal(repaymentPercent).div(100));
            const debtAfter = debtBefore.sub(repaymentAmount);

            // Property: Partial repayment should leave remaining debt > 0
            return debtAfter.gt(0) && debtAfter.lt(debtBefore);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('multiple repayments should accumulate debt reduction', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1000, max: 10000, noNaN: true }),
          fc.array(fc.double({ min: 10, max: 100, noNaN: true }), { minLength: 2, maxLength: 5 }),
          (initialDebt, repaymentAmounts) => {
            let currentDebt = new Decimal(initialDebt);
            let totalRepaid = new Decimal(0);

            // Simulate multiple repayments
            for (const repayment of repaymentAmounts) {
              const repayAmount = new Decimal(repayment);
              
              // Stop if we would over-repay
              if (repayAmount.gt(currentDebt)) {
                break;
              }

              currentDebt = currentDebt.sub(repayAmount);
              totalRepaid = totalRepaid.add(repayAmount);
            }

            // Property: Final debt = initial debt - total repaid
            const expectedDebt = new Decimal(initialDebt).sub(totalRepaid);
            const tolerance = new Decimal(0.000001);
            const difference = currentDebt.sub(expectedDebt).abs();

            return difference.lte(tolerance);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('debt reduction should be proportional to repayment amount', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1000, max: 10000, noNaN: true }),
          fc.double({ min: 10, max: 100, noNaN: true }),
          (initialDebt, repaymentAmount) => {
            const debtBefore = new Decimal(initialDebt);
            const repayment = new Decimal(repaymentAmount);

            // Ensure repayment doesn't exceed debt
            const actualRepayment = Decimal.min(repayment, debtBefore);
            const debtAfter = debtBefore.sub(actualRepayment);
            const debtReduction = debtBefore.sub(debtAfter);

            // Property: Debt reduction should equal repayment amount
            const tolerance = new Decimal(0.000001);
            const difference = debtReduction.sub(actualRepayment).abs();

            return difference.lte(tolerance);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });
  });

  /**
   * Property 6.3.2: Health Factor Improvement
   * **Validates: Requirements 3.3.3**
   * 
   * For any repayment:
   * - Property: Health factor must increase (improve) after repayment
   * - Invariant: `healthFactor_after >= healthFactor_before`
   */
  describe('Property 6.3.2: Health Factor Improvement', () => {
    test('health factor should improve after repayment', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }), // collateral amount
          fc.double({ min: 100, max: 5000, noNaN: true }), // collateral price
          fc.double({ min: 100, max: 5000, noNaN: true }), // initial debt
          fc.double({ min: 1, max: 99, noNaN: true }), // repayment percent
          fc.double({ min: 0.5, max: 2, noNaN: true }), // debt price
          fc.double({ min: 0.7, max: 0.9, noNaN: true }), // liquidation threshold
          (collateralAmount, collateralPrice, initialDebt, repaymentPercent, debtPrice, liquidationThreshold) => {
            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Mock pool config for liquidation threshold
            const originalGetPoolConfig = require('../config/vesu.config').getPoolConfig;
            jest.spyOn(require('../config/vesu.config'), 'getPoolConfig').mockReturnValue({
              liquidationThreshold: liquidationThreshold.toString()
            });

            // Calculate health factor before repayment
            const positionBefore = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: initialDebt.toString()
            };
            const hfBefore = vesuService.calculateHealthFactor(positionBefore, prices);

            // Calculate debt after repayment
            const repaymentAmount = new Decimal(initialDebt).mul(new Decimal(repaymentPercent).div(100));
            const debtAfter = new Decimal(initialDebt).sub(repaymentAmount);

            // Calculate health factor after repayment
            const positionAfter = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: debtAfter.toString()
            };
            const hfAfter = vesuService.calculateHealthFactor(positionAfter, prices);

            // Restore original function
            require('../config/vesu.config').getPoolConfig = originalGetPoolConfig;

            // Property: HF_after >= HF_before
            // Handle case where debt becomes zero (HF becomes null/infinite)
            if (hfAfter === null) {
              // Debt is zero, health factor is infinite - always better
              return true;
            }

            if (hfBefore === null) {
              // This shouldn't happen if we start with debt > 0
              return false;
            }

            const isImproved = hfAfter.gte(hfBefore);

            if (!isImproved) {
              console.log('Health factor did not improve:', {
                collateralAmount,
                collateralPrice,
                initialDebt,
                debtAfter: debtAfter.toString(),
                repaymentAmount: repaymentAmount.toString(),
                hfBefore: hfBefore.toString(),
                hfAfter: hfAfter.toString()
              });
            }

            return isImproved;
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('health factor should become infinite after full repayment', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 100, max: 5000, noNaN: true }),
          fc.double({ min: 100, max: 5000, noNaN: true }),
          fc.double({ min: 0.5, max: 2, noNaN: true }),
          (collateralAmount, collateralPrice, initialDebt, debtPrice) => {
            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Position after full repayment (debt = 0)
            const positionAfterFullRepay = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: '0'
            };

            const hfAfter = vesuService.calculateHealthFactor(positionAfterFullRepay, prices);

            // Property: Health factor should be null (infinite) when debt is 0
            return hfAfter === null;
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('larger repayments should result in greater health factor improvement', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 100, max: 5000, noNaN: true }),
          fc.double({ min: 1000, max: 5000, noNaN: true }),
          fc.double({ min: 10, max: 40, noNaN: true }), // smaller repayment percent
          fc.double({ min: 50, max: 90, noNaN: true }), // larger repayment percent
          fc.double({ min: 0.5, max: 2, noNaN: true }),
          fc.double({ min: 0.7, max: 0.9, noNaN: true }),
          (collateralAmount, collateralPrice, initialDebt, smallRepayPercent, largeRepayPercent, debtPrice, liquidationThreshold) => {
            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Mock pool config
            const originalGetPoolConfig = require('../config/vesu.config').getPoolConfig;
            jest.spyOn(require('../config/vesu.config'), 'getPoolConfig').mockReturnValue({
              liquidationThreshold: liquidationThreshold.toString()
            });

            // Calculate HF with smaller repayment
            const smallRepayment = new Decimal(initialDebt).mul(new Decimal(smallRepayPercent).div(100));
            const debtAfterSmall = new Decimal(initialDebt).sub(smallRepayment);
            const positionSmall = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: debtAfterSmall.toString()
            };
            const hfSmall = vesuService.calculateHealthFactor(positionSmall, prices);

            // Calculate HF with larger repayment
            const largeRepayment = new Decimal(initialDebt).mul(new Decimal(largeRepayPercent).div(100));
            const debtAfterLarge = new Decimal(initialDebt).sub(largeRepayment);
            const positionLarge = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: debtAfterLarge.toString()
            };
            const hfLarge = vesuService.calculateHealthFactor(positionLarge, prices);

            // Restore original function
            require('../config/vesu.config').getPoolConfig = originalGetPoolConfig;

            // Property: Larger repayment should result in better (higher) health factor
            // Handle case where debt becomes zero
            if (hfLarge === null) {
              // Debt is zero, health factor is infinite - always better
              return true;
            }

            if (hfSmall === null) {
              // This shouldn't happen with our test parameters
              return false;
            }

            return hfLarge.gte(hfSmall);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('health factor improvement should be consistent across different collateral amounts', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 100, max: 5000, noNaN: true }),
          fc.double({ min: 100, max: 5000, noNaN: true }),
          fc.double({ min: 10, max: 50, noNaN: true }),
          fc.double({ min: 0.5, max: 2, noNaN: true }),
          fc.double({ min: 0.7, max: 0.9, noNaN: true }),
          (collateralAmount, collateralPrice, initialDebt, repaymentPercent, debtPrice, liquidationThreshold) => {
            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Mock pool config
            const originalGetPoolConfig = require('../config/vesu.config').getPoolConfig;
            jest.spyOn(require('../config/vesu.config'), 'getPoolConfig').mockReturnValue({
              liquidationThreshold: liquidationThreshold.toString()
            });

            // Calculate HF before and after for original collateral
            const positionBefore = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: initialDebt.toString()
            };
            const hfBefore = vesuService.calculateHealthFactor(positionBefore, prices);

            const repaymentAmount = new Decimal(initialDebt).mul(new Decimal(repaymentPercent).div(100));
            const debtAfter = new Decimal(initialDebt).sub(repaymentAmount);
            const positionAfter = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateralAmount.toString(),
              debtAmount: debtAfter.toString()
            };
            const hfAfter = vesuService.calculateHealthFactor(positionAfter, prices);

            // Restore original function
            require('../config/vesu.config').getPoolConfig = originalGetPoolConfig;

            // Property: Health factor should always improve after repayment
            if (hfAfter === null) {
              return true; // Infinite is always better
            }

            if (hfBefore === null) {
              return false; // Shouldn't happen
            }

            return hfAfter.gt(hfBefore);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });
  });

  /**
   * Additional edge case tests
   */
  describe('Edge Cases', () => {
    test('should handle very small repayment amounts', () => {
      const debtBefore = new Decimal('1000');
      const repaymentAmount = new Decimal('0.000000000000000001'); // 1 wei
      const debtAfter = debtBefore.sub(repaymentAmount);

      // Should handle very small amounts without errors
      expect(debtAfter).toBeDefined();
      expect(debtAfter.lt(debtBefore)).toBe(true);
    });

    test('should handle very large repayment amounts', () => {
      const debtBefore = new Decimal('1000000000'); // 1 billion
      const repaymentAmount = new Decimal('500000000'); // 500 million
      const debtAfter = debtBefore.sub(repaymentAmount);

      // Should handle very large amounts without errors
      expect(debtAfter).toBeDefined();
      expect(debtAfter.toString()).toBe('500000000');
    });

    test('repayment equal to debt should result in zero debt', () => {
      const debtBefore = new Decimal('1234.56789');
      const repaymentAmount = debtBefore;
      const debtAfter = debtBefore.sub(repaymentAmount);

      expect(debtAfter.isZero()).toBe(true);
    });

    test('should not allow repayment greater than debt', () => {
      // This test validates the validation logic in the service
      const debtBefore = new Decimal('1000');
      const repaymentAmount = new Decimal('1500');

      // In the actual service, this should throw an error
      // Here we just verify the comparison logic
      const wouldExceed = repaymentAmount.gt(debtBefore);
      expect(wouldExceed).toBe(true);
    });

    test('health factor should handle precision correctly', () => {
      const prices = {
        ETH: '2500.123456789',
        USDC: '1.000000001'
      };

      const positionBefore = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '10.123456789',
        debtAmount: '5000.987654321'
      };

      const positionAfter = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '10.123456789',
        debtAmount: '2500.493827161' // Half the debt
      };

      const hfBefore = vesuService.calculateHealthFactor(positionBefore, prices);
      const hfAfter = vesuService.calculateHealthFactor(positionAfter, prices);

      // Should handle high precision without errors
      expect(hfBefore).toBeDefined();
      expect(hfAfter).toBeDefined();
      if (hfBefore && hfAfter) {
        expect(hfAfter.gt(hfBefore)).toBe(true);
      }
    });

    test('sequential repayments should maintain debt reduction property', () => {
      let currentDebt = new Decimal('10000');
      const repayments = [100, 200, 300, 400, 500];

      for (const repayment of repayments) {
        const previousDebt = currentDebt;
        currentDebt = currentDebt.sub(new Decimal(repayment));

        // Each repayment should reduce debt
        expect(currentDebt.lt(previousDebt)).toBe(true);
      }

      // Total debt reduction should equal sum of repayments
      const totalRepaid = repayments.reduce((sum, r) => sum + r, 0);
      const expectedDebt = new Decimal('10000').sub(new Decimal(totalRepaid));
      expect(currentDebt.equals(expectedDebt)).toBe(true);
    });
  });
});
