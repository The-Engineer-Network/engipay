const fc = require('fast-check');
const Decimal = require('decimal.js');
const { VesuService } = require('../services/VesuService');

/**
 * Property-Based Tests for Vesu Withdraw Operations
 * 
 * These tests validate correctness properties for withdraw operations
 * as defined in the design document (Section 6.4)
 */

describe('Vesu Withdraw Operations - Property-Based Tests', () => {
  let vesuService;

  beforeAll(() => {
    // Set decimal precision for tests
    Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });
  });

  beforeEach(() => {
    // Create mock dependencies
    const mockContractManager = {
      getVTokenExchangeRateForPool: jest.fn().mockResolvedValue('1000000000000000000'), // 1.0
      getVTokenBalance: jest.fn().mockResolvedValue('0'),
      provider: {}
    };

    const mockOracleService = {
      getPrice: jest.fn().mockResolvedValue('2500'),
      getPrices: jest.fn().mockResolvedValue({ ETH: '2500', USDC: '1' })
    };

    const mockTransactionManager = {
      executeWithdraw: jest.fn().mockResolvedValue('0x123'),
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
   * Property 6.4.1: Collateral Safety
   * **Validates: Requirements 3.4.2**
   * 
   * For any withdrawal from a position with debt:
   * - Property: Withdrawal must be rejected if it would result in health factor < 1.0
   * - Invariant: `healthFactor(position_after_withdraw) >= 1.0` OR `debt == 0`
   */
  describe('Property 6.4.1: Collateral Safety', () => {
    test('health factor should remain >= 1.0 after withdrawal when debt exists', () => {
      fc.assert(
        fc.property(
          // Generate collateral amounts between 1 and 100 ETH
          fc.double({ min: 1, max: 100, noNaN: true }),
          // Generate debt amounts (ensuring position starts healthy)
          fc.double({ min: 100, max: 5000, noNaN: true }),
          // Generate withdrawal percentage (0.1 to 0.5 of collateral)
          fc.double({ min: 0.1, max: 0.5, noNaN: true }),
          // Liquidation threshold (typically 0.8)
          fc.double({ min: 0.75, max: 0.85, noNaN: true }),
          (collateralAmount, debtAmount, withdrawPct, liquidationThreshold) => {
            const collateralPrice = new Decimal('2500'); // ETH price
            const debtPrice = new Decimal('1'); // USDC price

            const collateral = new Decimal(collateralAmount);
            const debt = new Decimal(debtAmount);
            const liqThreshold = new Decimal(liquidationThreshold);

            // Create position
            const position = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateral.toString(),
              debtAmount: debt.toString()
            };

            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Calculate initial health factor
            const initialHF = vesuService.calculateHealthFactor(position, prices);

            // Skip if position is already unhealthy
            if (initialHF && initialHF.lt(new Decimal(1.0))) {
              return true;
            }

            // Calculate maximum withdrawable
            const maxWithdrawable = vesuService.calculateMaxWithdrawable(position, prices);

            // Try to withdraw a safe amount (less than max)
            const withdrawAmount = maxWithdrawable.mul(new Decimal(withdrawPct));

            // Skip if withdrawal amount is too small
            if (withdrawAmount.lte(new Decimal(0.001))) {
              return true;
            }

            // Calculate position after withdrawal
            const newCollateral = collateral.sub(withdrawAmount);
            const positionAfterWithdraw = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: newCollateral.toString(),
              debtAmount: debt.toString()
            };

            // Calculate health factor after withdrawal
            const newHF = vesuService.calculateHealthFactor(positionAfterWithdraw, prices);

            // Property: Health factor should remain >= 1.0
            const isValid = !newHF || newHF.gte(new Decimal(1.0));

            if (!isValid) {
              console.log('Property violation detected:', {
                initialCollateral: collateral.toString(),
                withdrawAmount: withdrawAmount.toString(),
                newCollateral: newCollateral.toString(),
                debt: debt.toString(),
                initialHF: initialHF ? initialHF.toString() : 'infinite',
                newHF: newHF ? newHF.toString() : 'infinite',
                maxWithdrawable: maxWithdrawable.toString()
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

    test('withdrawal should be rejected if it would cause health factor < 1.0', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 10, noNaN: true }), // collateral
          fc.double({ min: 1000, max: 5000, noNaN: true }), // debt
          fc.double({ min: 0.6, max: 0.95, noNaN: true }), // aggressive withdrawal pct
          (collateralAmount, debtAmount, withdrawPct) => {
            const collateralPrice = new Decimal('2500');
            const debtPrice = new Decimal('1');

            const collateral = new Decimal(collateralAmount);
            const debt = new Decimal(debtAmount);

            const position = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateral.toString(),
              debtAmount: debt.toString()
            };

            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Calculate max withdrawable
            const maxWithdrawable = vesuService.calculateMaxWithdrawable(position, prices);

            // Try to withdraw more than max (aggressive)
            const withdrawAmount = collateral.mul(new Decimal(withdrawPct));

            // If withdrawal exceeds max, it should be rejected
            if (withdrawAmount.gt(maxWithdrawable)) {
              const newCollateral = collateral.sub(withdrawAmount);
              
              // Skip if new collateral is negative
              if (newCollateral.lt(new Decimal(0))) {
                return true;
              }

              const positionAfterWithdraw = {
                collateralAsset: 'ETH',
                debtAsset: 'USDC',
                collateralAmount: newCollateral.toString(),
                debtAmount: debt.toString()
              };

              const newHF = vesuService.calculateHealthFactor(positionAfterWithdraw, prices);

              // Property: If withdrawal > max, health factor should be < 1.0
              return !newHF || newHF.lt(new Decimal(1.0));
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

    test('positions with no debt can withdraw all collateral', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.1, max: 1000, noNaN: true }),
          (collateralAmount) => {
            const collateral = new Decimal(collateralAmount);

            const position = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateral.toString(),
              debtAmount: '0'
            };

            const prices = {
              ETH: '2500',
              USDC: '1'
            };

            // Calculate max withdrawable
            const maxWithdrawable = vesuService.calculateMaxWithdrawable(position, prices);

            // Property: With no debt, can withdraw all collateral
            const tolerance = collateral.mul(0.000001);
            const difference = maxWithdrawable.sub(collateral).abs();

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
   * Property 6.4.2: vToken Conversion
   * **Validates: Requirements 3.4.3**
   * 
   * For any withdrawal:
   * - Given: vTokens burned `v`, exchange rate `r`
   * - Property: Underlying assets received `u` must satisfy: `u = v * r` (within rounding tolerance)
   * - Invariant: Conversion follows ERC-4626 standard
   */
  describe('Property 6.4.2: vToken Conversion', () => {
    test('assets received should equal vTokens burned times exchange rate', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 1000, noNaN: true }), // withdraw amount
          fc.double({ min: 0.9, max: 1.5, noNaN: true }), // exchange rate
          (withdrawAmount, exchangeRate) => {
            const amount = new Decimal(withdrawAmount);
            const rate = new Decimal(exchangeRate);

            // Calculate vTokens to burn (same formula as supply)
            const vTokensToBurn = vesuService.calculateVTokensToReceive(amount, rate);

            // Calculate assets received from vTokens
            const assetsReceived = vesuService.calculateUnderlyingValue(vTokensToBurn, rate);

            // Property: assets received should equal withdraw amount
            const tolerance = amount.mul(0.000001);
            const difference = assetsReceived.sub(amount).abs();

            const isValid = difference.lte(tolerance);

            if (!isValid) {
              console.log('Property violation detected:', {
                withdrawAmount: amount.toString(),
                exchangeRate: rate.toString(),
                vTokensToBurn: vTokensToBurn.toString(),
                assetsReceived: assetsReceived.toString(),
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

    test('vToken burning should be deterministic', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 1000, noNaN: true }),
          fc.double({ min: 0.9, max: 1.5, noNaN: true }),
          (withdrawAmount, exchangeRate) => {
            const amount = new Decimal(withdrawAmount);
            const rate = new Decimal(exchangeRate);

            // Calculate vTokens to burn twice
            const vTokens1 = vesuService.calculateVTokensToReceive(amount, rate);
            const vTokens2 = vesuService.calculateVTokensToReceive(amount, rate);

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

    test('vToken conversion should be reversible', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 1000, noNaN: true }),
          fc.double({ min: 0.9, max: 1.5, noNaN: true }),
          (amount, exchangeRate) => {
            const amountDecimal = new Decimal(amount);
            const rateDecimal = new Decimal(exchangeRate);

            // Convert amount to vTokens
            const vTokens = vesuService.calculateVTokensToReceive(amountDecimal, rateDecimal);

            // Convert vTokens back to amount
            const recoveredAmount = vesuService.calculateUnderlyingValue(vTokens, rateDecimal);

            // Property: Should recover original amount (within tolerance)
            const tolerance = amountDecimal.mul(0.000001);
            const difference = recoveredAmount.sub(amountDecimal).abs();

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
   * Property 6.4.3: Maximum Withdrawal Calculation
   * **Validates: Requirements 3.4.4**
   * 
   * For any position:
   * - Property: Calculated max withdrawal `W_max` is the largest amount where 
   *   `healthFactor(position_after_withdraw(W_max)) >= 1.0`
   * - Invariant: `withdraw(W_max)` succeeds, `withdraw(W_max + ε)` fails for any `ε > 0`
   */
  describe('Property 6.4.3: Maximum Withdrawal Calculation', () => {
    test('withdrawing exactly max withdrawable should maintain health factor >= 1.0', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 100, max: 10000, noNaN: true }),
          fc.double({ min: 0.75, max: 0.85, noNaN: true }),
          (collateralAmount, debtAmount, liquidationThreshold) => {
            const collateralPrice = new Decimal('2500');
            const debtPrice = new Decimal('1');

            const collateral = new Decimal(collateralAmount);
            const debt = new Decimal(debtAmount);

            const position = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateral.toString(),
              debtAmount: debt.toString()
            };

            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Calculate initial health factor
            const initialHF = vesuService.calculateHealthFactor(position, prices);

            // Skip if position is already unhealthy
            if (initialHF && initialHF.lt(new Decimal(1.0))) {
              return true;
            }

            // Calculate max withdrawable
            const maxWithdrawable = vesuService.calculateMaxWithdrawable(position, prices);

            // Skip if max withdrawable is too small
            if (maxWithdrawable.lte(new Decimal(0.001))) {
              return true;
            }

            // Withdraw exactly max withdrawable
            const newCollateral = collateral.sub(maxWithdrawable);

            const positionAfterWithdraw = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: newCollateral.toString(),
              debtAmount: debt.toString()
            };

            const newHF = vesuService.calculateHealthFactor(positionAfterWithdraw, prices);

            // Property: Health factor should be >= 1.0 (or very close due to rounding)
            const minHealthFactor = new Decimal(0.999); // Allow tiny rounding error
            const isValid = !newHF || newHF.gte(minHealthFactor);

            if (!isValid) {
              console.log('Property violation detected:', {
                collateral: collateral.toString(),
                debt: debt.toString(),
                maxWithdrawable: maxWithdrawable.toString(),
                newCollateral: newCollateral.toString(),
                initialHF: initialHF ? initialHF.toString() : 'infinite',
                newHF: newHF ? newHF.toString() : 'infinite'
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

    test('withdrawing more than max should result in health factor < 1.0', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 100, max: 10000, noNaN: true }),
          fc.double({ min: 0.01, max: 0.1, noNaN: true }), // small epsilon
          (collateralAmount, debtAmount, epsilon) => {
            const collateralPrice = new Decimal('2500');
            const debtPrice = new Decimal('1');

            const collateral = new Decimal(collateralAmount);
            const debt = new Decimal(debtAmount);

            const position = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateral.toString(),
              debtAmount: debt.toString()
            };

            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Calculate max withdrawable
            const maxWithdrawable = vesuService.calculateMaxWithdrawable(position, prices);

            // Skip if max withdrawable is zero or very small
            if (maxWithdrawable.lte(new Decimal(0.1))) {
              return true;
            }

            // Try to withdraw more than max
            const excessWithdraw = maxWithdrawable.add(new Decimal(epsilon));

            // Skip if excess withdrawal exceeds total collateral
            if (excessWithdraw.gte(collateral)) {
              return true;
            }

            const newCollateral = collateral.sub(excessWithdraw);

            const positionAfterWithdraw = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: newCollateral.toString(),
              debtAmount: debt.toString()
            };

            const newHF = vesuService.calculateHealthFactor(positionAfterWithdraw, prices);

            // Property: Health factor should be < 1.0
            return !newHF || newHF.lt(new Decimal(1.0));
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('max withdrawable should be monotonic with collateral', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 100, max: 10000, noNaN: true }),
          fc.double({ min: 1.1, max: 2, noNaN: true }), // collateral multiplier
          (collateralAmount, debtAmount, multiplier) => {
            const collateralPrice = new Decimal('2500');
            const debtPrice = new Decimal('1');

            const collateral1 = new Decimal(collateralAmount);
            const collateral2 = collateral1.mul(new Decimal(multiplier));
            const debt = new Decimal(debtAmount);

            const position1 = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateral1.toString(),
              debtAmount: debt.toString()
            };

            const position2 = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateral2.toString(),
              debtAmount: debt.toString()
            };

            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            const maxWithdraw1 = vesuService.calculateMaxWithdrawable(position1, prices);
            const maxWithdraw2 = vesuService.calculateMaxWithdrawable(position2, prices);

            // Property: More collateral should allow more withdrawal
            return maxWithdraw2.gte(maxWithdraw1);
          }
        ),
        {
          numRuns: 1000,
          verbose: false
        }
      );
    });

    test('max withdrawable should be inversely related to debt', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 10, max: 100, noNaN: true }),
          fc.double({ min: 100, max: 5000, noNaN: true }),
          fc.double({ min: 1.1, max: 2, noNaN: true }), // debt multiplier
          (collateralAmount, debtAmount, multiplier) => {
            const collateralPrice = new Decimal('2500');
            const debtPrice = new Decimal('1');

            const collateral = new Decimal(collateralAmount);
            const debt1 = new Decimal(debtAmount);
            const debt2 = debt1.mul(new Decimal(multiplier));

            const position1 = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateral.toString(),
              debtAmount: debt1.toString()
            };

            const position2 = {
              collateralAsset: 'ETH',
              debtAsset: 'USDC',
              collateralAmount: collateral.toString(),
              debtAmount: debt2.toString()
            };

            const prices = {
              ETH: collateralPrice.toString(),
              USDC: debtPrice.toString()
            };

            // Skip if position2 is already unhealthy
            const hf2 = vesuService.calculateHealthFactor(position2, prices);
            if (hf2 && hf2.lt(new Decimal(1.0))) {
              return true;
            }

            const maxWithdraw1 = vesuService.calculateMaxWithdrawable(position1, prices);
            const maxWithdraw2 = vesuService.calculateMaxWithdrawable(position2, prices);

            // Property: More debt should allow less withdrawal
            return maxWithdraw2.lte(maxWithdraw1);
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
    test('should handle very small withdrawal amounts', () => {
      const smallAmount = new Decimal('0.000000000000000001'); // 1 wei
      const exchangeRate = new Decimal('1.0');

      const vTokens = vesuService.calculateVTokensToReceive(smallAmount, exchangeRate);
      const assetsReceived = vesuService.calculateUnderlyingValue(vTokens, exchangeRate);

      // Should maintain precision for very small amounts
      expect(assetsReceived.toString()).toBe(smallAmount.toString());
    });

    test('should handle very large withdrawal amounts', () => {
      const largeAmount = new Decimal('1000000000'); // 1 billion
      const exchangeRate = new Decimal('1.0');

      const vTokens = vesuService.calculateVTokensToReceive(largeAmount, exchangeRate);
      const assetsReceived = vesuService.calculateUnderlyingValue(vTokens, exchangeRate);

      const tolerance = largeAmount.mul(0.000001);
      const difference = assetsReceived.sub(largeAmount).abs();

      expect(difference.lte(tolerance)).toBe(true);
    });

    test('should handle exchange rate of exactly 1.0', () => {
      const amount = new Decimal('100');
      const exchangeRate = new Decimal('1.0');

      const vTokens = vesuService.calculateVTokensToReceive(amount, exchangeRate);

      // With 1:1 exchange rate, vTokens should equal amount
      expect(vTokens.toString()).toBe(amount.toString());
    });

    test('max withdrawable should be zero when position is at liquidation threshold', () => {
      // Create a position exactly at liquidation threshold
      const collateral = new Decimal('1'); // 1 ETH
      const collateralPrice = new Decimal('2500');
      const liquidationThreshold = new Decimal('0.8');
      
      // Debt that makes HF exactly 1.0
      // HF = (collateral * price * liqThreshold) / debt = 1.0
      // debt = collateral * price * liqThreshold
      const debt = collateral.mul(collateralPrice).mul(liquidationThreshold);

      const position = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: collateral.toString(),
        debtAmount: debt.toString()
      };

      const prices = {
        ETH: collateralPrice.toString(),
        USDC: '1'
      };

      const maxWithdrawable = vesuService.calculateMaxWithdrawable(position, prices);

      // Max withdrawable should be very close to zero
      expect(maxWithdrawable.lte(new Decimal(0.001))).toBe(true);
    });
  });
});
