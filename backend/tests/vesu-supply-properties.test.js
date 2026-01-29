const fc = require('fast-check');
const Decimal = require('decimal.js');
const { VesuService } = require('../services/VesuService');

/**
 * Property-Based Tests for Vesu Supply Operations
 * 
 * These tests validate correctness properties for supply operations
 * as defined in the design document (Section 6.1)
 */

describe('Vesu Supply Operations - Property-Based Tests', () => {
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
   * Property 6.1.1: vToken Minting Correctness
   * **Validates: Requirements 3.1.2, 3.1.3**
   * 
   * For any valid supply operation:
   * - Given: supply amount `s` and exchange rate `r`
   * - Property: vTokens minted `v` must satisfy: `v = s / r` (within rounding tolerance)
   * - Invariant: `v * r ≈ s` (underlying value equals supplied amount)
   */
  describe('Property 6.1.1: vToken Minting Correctness', () => {
    test('vTokens minted should equal supply amount divided by exchange rate', () => {
      fc.assert(
        fc.property(
          // Generate supply amounts between 0.01 and 10000
          fc.double({ min: 0.01, max: 10000, noNaN: true }),
          // Generate exchange rates between 0.9 and 1.5 (typical range)
          fc.double({ min: 0.9, max: 1.5, noNaN: true }),
          (supplyAmount, exchangeRate) => {
            // Convert to Decimal for precise calculations
            const supplyDecimal = new Decimal(supplyAmount);
            const exchangeRateDecimal = new Decimal(exchangeRate);

            // Calculate vTokens using the service method
            const vTokens = vesuService.calculateVTokensToReceive(
              supplyDecimal,
              exchangeRateDecimal
            );

            // Calculate underlying value from vTokens
            const underlyingValue = vesuService.calculateUnderlyingValue(
              vTokens,
              exchangeRateDecimal
            );

            // Property: v * r ≈ s
            // Allow small rounding tolerance (0.0001%)
            const tolerance = supplyDecimal.mul(0.000001);
            const difference = underlyingValue.sub(supplyDecimal).abs();

            // Verify the invariant holds
            const isValid = difference.lte(tolerance);

            if (!isValid) {
              console.log('Property violation detected:', {
                supplyAmount: supplyDecimal.toString(),
                exchangeRate: exchangeRateDecimal.toString(),
                vTokens: vTokens.toString(),
                underlyingValue: underlyingValue.toString(),
                difference: difference.toString(),
                tolerance: tolerance.toString()
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

    test('vTokens calculation should be deterministic', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 10000, noNaN: true }),
          fc.double({ min: 0.9, max: 1.5, noNaN: true }),
          (supplyAmount, exchangeRate) => {
            const supplyDecimal = new Decimal(supplyAmount);
            const exchangeRateDecimal = new Decimal(exchangeRate);

            // Calculate vTokens twice
            const vTokens1 = vesuService.calculateVTokensToReceive(
              supplyDecimal,
              exchangeRateDecimal
            );
            const vTokens2 = vesuService.calculateVTokensToReceive(
              supplyDecimal,
              exchangeRateDecimal
            );

            // Property: Same inputs should produce same outputs
            return vTokens1.equals(vTokens2);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('vTokens should scale linearly with supply amount', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 5000, noNaN: true }),
          fc.double({ min: 0.9, max: 1.5, noNaN: true }),
          fc.double({ min: 1.5, max: 3, noNaN: true }), // scaling factor
          (supplyAmount, exchangeRate, scaleFactor) => {
            const supplyDecimal = new Decimal(supplyAmount);
            const exchangeRateDecimal = new Decimal(exchangeRate);
            const scaleDecimal = new Decimal(scaleFactor);

            // Calculate vTokens for original amount
            const vTokens1 = vesuService.calculateVTokensToReceive(
              supplyDecimal,
              exchangeRateDecimal
            );

            // Calculate vTokens for scaled amount
            const scaledSupply = supplyDecimal.mul(scaleDecimal);
            const vTokens2 = vesuService.calculateVTokensToReceive(
              scaledSupply,
              exchangeRateDecimal
            );

            // Property: vTokens should scale proportionally
            const expectedVTokens = vTokens1.mul(scaleDecimal);
            const tolerance = expectedVTokens.mul(0.000001);
            const difference = vTokens2.sub(expectedVTokens).abs();

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
   * Property 6.1.2: Supply Monotonicity
   * **Validates: Requirements 3.1.5**
   * 
   * For any position with supplied assets:
   * - Property: Underlying asset value must be monotonically non-decreasing over time
   * - Invariant: `underlyingValue(t2) >= underlyingValue(t1)` for all `t2 > t1`
   */
  describe('Property 6.1.2: Supply Monotonicity', () => {
    test('underlying value should increase when exchange rate increases', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 1000, noNaN: true }), // vToken balance
          fc.double({ min: 0.9, max: 1.5, noNaN: true }), // initial exchange rate
          fc.double({ min: 0.01, max: 0.5, noNaN: true }), // rate increase
          (vTokenBalance, initialRate, rateIncrease) => {
            const vTokenDecimal = new Decimal(vTokenBalance);
            const rate1 = new Decimal(initialRate);
            const rate2 = rate1.add(new Decimal(rateIncrease));

            // Calculate underlying value at time t1
            const value1 = vesuService.calculateUnderlyingValue(vTokenDecimal, rate1);

            // Calculate underlying value at time t2 (after rate increase)
            const value2 = vesuService.calculateUnderlyingValue(vTokenDecimal, rate2);

            // Property: value2 >= value1 (monotonically non-decreasing)
            return value2.gte(value1);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('underlying value should remain constant when exchange rate is constant', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 1000, noNaN: true }),
          fc.double({ min: 0.9, max: 1.5, noNaN: true }),
          (vTokenBalance, exchangeRate) => {
            const vTokenDecimal = new Decimal(vTokenBalance);
            const rateDecimal = new Decimal(exchangeRate);

            // Calculate underlying value at two different times with same rate
            const value1 = vesuService.calculateUnderlyingValue(vTokenDecimal, rateDecimal);
            const value2 = vesuService.calculateUnderlyingValue(vTokenDecimal, rateDecimal);

            // Property: values should be equal
            return value1.equals(value2);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('underlying value should never decrease for same vToken balance', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 1000, noNaN: true }),
          fc.array(fc.double({ min: 0.9, max: 2.0, noNaN: true }), { minLength: 2, maxLength: 10 }),
          (vTokenBalance, exchangeRates) => {
            const vTokenDecimal = new Decimal(vTokenBalance);
            
            // Sort exchange rates to simulate time progression
            const sortedRates = exchangeRates.sort((a, b) => a - b);

            // Calculate underlying values over time
            const values = sortedRates.map(rate => 
              vesuService.calculateUnderlyingValue(vTokenDecimal, new Decimal(rate))
            );

            // Property: Each value should be >= previous value
            for (let i = 1; i < values.length; i++) {
              if (values[i].lt(values[i - 1])) {
                return false;
              }
            }

            return true;
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('multiple supplies should accumulate correctly', () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: 0.01, max: 100, noNaN: true }), { minLength: 2, maxLength: 5 }),
          fc.double({ min: 0.9, max: 1.5, noNaN: true }),
          (supplyAmounts, exchangeRate) => {
            const rateDecimal = new Decimal(exchangeRate);

            // Calculate total supply
            const totalSupply = supplyAmounts.reduce(
              (sum, amount) => sum.add(new Decimal(amount)),
              new Decimal(0)
            );

            // Calculate vTokens for total supply
            const totalVTokens = vesuService.calculateVTokensToReceive(totalSupply, rateDecimal);

            // Calculate vTokens for each supply and sum them
            const summedVTokens = supplyAmounts.reduce(
              (sum, amount) => {
                const vTokens = vesuService.calculateVTokensToReceive(
                  new Decimal(amount),
                  rateDecimal
                );
                return sum.add(vTokens);
              },
              new Decimal(0)
            );

            // Property: Total vTokens should equal sum of individual vTokens
            const tolerance = totalVTokens.mul(0.000001);
            const difference = totalVTokens.sub(summedVTokens).abs();

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
   * Additional edge case tests
   */
  describe('Edge Cases', () => {
    test('should handle very small supply amounts', () => {
      const smallAmount = new Decimal('0.000000000000000001'); // 1 wei
      const exchangeRate = new Decimal('1.0');

      const vTokens = vesuService.calculateVTokensToReceive(smallAmount, exchangeRate);
      const underlyingValue = vesuService.calculateUnderlyingValue(vTokens, exchangeRate);

      // Should maintain precision for very small amounts
      expect(underlyingValue.toString()).toBe(smallAmount.toString());
    });

    test('should handle very large supply amounts', () => {
      const largeAmount = new Decimal('1000000000000000000'); // 1 billion ETH
      const exchangeRate = new Decimal('1.0');

      const vTokens = vesuService.calculateVTokensToReceive(largeAmount, exchangeRate);
      const underlyingValue = vesuService.calculateUnderlyingValue(vTokens, exchangeRate);

      // Should maintain precision for very large amounts
      const tolerance = largeAmount.mul(0.000001);
      const difference = underlyingValue.sub(largeAmount).abs();

      expect(difference.lte(tolerance)).toBe(true);
    });

    test('should handle exchange rate of exactly 1.0', () => {
      const amount = new Decimal('100');
      const exchangeRate = new Decimal('1.0');

      const vTokens = vesuService.calculateVTokensToReceive(amount, exchangeRate);

      // With 1:1 exchange rate, vTokens should equal supply amount
      expect(vTokens.toString()).toBe(amount.toString());
    });
  });
});
