const { VesuService, VesuError, ErrorCodes } = require('../services/VesuService');
const Decimal = require('decimal.js');

describe('VesuService - Basic Functionality', () => {
  let vesuService;
  let mockContracts;
  let mockOracle;
  let mockTxManager;

  beforeEach(() => {
    // Create mock dependencies to avoid requiring environment variables
    mockContracts = {
      provider: { mock: 'provider' },
      initializePoolContract: jest.fn(),
      callPoolMethod: jest.fn(),
    };
    
    mockOracle = {
      getPrice: jest.fn(),
      getPrices: jest.fn(),
    };
    
    mockTxManager = {
      submitTransaction: jest.fn(),
      waitForConfirmation: jest.fn(),
    };

    // Initialize VesuService with mocked dependencies
    vesuService = new VesuService(mockContracts, mockOracle, mockTxManager);
  });

  describe('Initialization', () => {
    test('should initialize with mocked dependencies', () => {
      expect(vesuService).toBeDefined();
      expect(vesuService.contracts).toBe(mockContracts);
      expect(vesuService.oracle).toBe(mockOracle);
      expect(vesuService.txManager).toBe(mockTxManager);
      expect(vesuService.config).toBeDefined();
    });

    test('should initialize with custom dependencies', () => {
      const customContracts = { provider: 'custom' };
      const customOracle = { getPrice: jest.fn() };
      const customTxManager = { submitTransaction: jest.fn() };

      const service = new VesuService(customContracts, customOracle, customTxManager);

      expect(service.contracts).toBe(customContracts);
      expect(service.oracle).toBe(customOracle);
      expect(service.txManager).toBe(customTxManager);
    });
  });

  describe('Health Factor Calculation', () => {
    test('should return null for position with no debt', () => {
      const position = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '1.5',
        debtAmount: '0',
      };
      const prices = { ETH: '2500', USDC: '1' };

      const healthFactor = vesuService.calculateHealthFactor(position, prices);

      expect(healthFactor).toBeNull();
    });

    test('should calculate health factor correctly', () => {
      const position = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '1.5',
        debtAmount: '1000',
      };
      const prices = { ETH: '2500', USDC: '1' };

      const healthFactor = vesuService.calculateHealthFactor(position, prices);

      // Collateral value: 1.5 * 2500 = 3750
      // Liquidation threshold: 0.80 (from config)
      // Risk-adjusted collateral: 3750 * 0.80 = 3000
      // Debt value: 1000 * 1 = 1000
      // Health factor: 3000 / 1000 = 3.0
      expect(healthFactor.toString()).toBe('3');
    });

    test('should throw error for invalid position', () => {
      const position = null;
      const prices = { ETH: '2500', USDC: '1' };

      expect(() => {
        vesuService.calculateHealthFactor(position, prices);
      }).toThrow(VesuError);
    });

    test('should throw error for missing prices', () => {
      const position = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '1.5',
        debtAmount: '1000',
      };
      const prices = { ETH: '2500' }; // Missing USDC price

      expect(() => {
        vesuService.calculateHealthFactor(position, prices);
      }).toThrow(VesuError);
    });
  });

  describe('LTV Calculation', () => {
    test('should return 0 for position with no collateral', () => {
      const position = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '0',
        debtAmount: '1000',
      };
      const prices = { ETH: '2500', USDC: '1' };

      const ltv = vesuService.calculateLTV(position, prices);

      expect(ltv.toString()).toBe('0');
    });

    test('should calculate LTV correctly', () => {
      const position = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '1.5',
        debtAmount: '1000',
      };
      const prices = { ETH: '2500', USDC: '1' };

      const ltv = vesuService.calculateLTV(position, prices);

      // Collateral value: 1.5 * 2500 = 3750
      // Debt value: 1000 * 1 = 1000
      // LTV: 1000 / 3750 = 0.266666... (rounds down to 0.266)
      expect(ltv.toFixed(3)).toBe('0.266');
    });
  });

  describe('Max Borrowable Calculation', () => {
    test('should calculate max borrowable correctly', () => {
      const collateralAmount = new Decimal('1.5');
      const collateralPrice = new Decimal('2500');
      const debtPrice = new Decimal('1');
      const maxLTV = new Decimal('0.75');

      const maxBorrowable = vesuService.calculateMaxBorrowable(
        collateralAmount,
        collateralPrice,
        debtPrice,
        maxLTV
      );

      // Collateral value: 1.5 * 2500 = 3750
      // Max debt value: 3750 * 0.75 = 2812.5
      // Max borrowable: 2812.5 / 1 = 2812.5
      expect(maxBorrowable.toString()).toBe('2812.5');
    });
  });

  describe('Max Withdrawable Calculation', () => {
    test('should return full collateral when no debt', () => {
      const position = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '1.5',
        debtAmount: '0',
      };
      const prices = { ETH: '2500', USDC: '1' };

      const maxWithdrawable = vesuService.calculateMaxWithdrawable(position, prices);

      expect(maxWithdrawable.toString()).toBe('1.5');
    });

    test('should calculate max withdrawable with debt', () => {
      const position = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '1.5',
        debtAmount: '1000',
      };
      const prices = { ETH: '2500', USDC: '1' };

      const maxWithdrawable = vesuService.calculateMaxWithdrawable(position, prices);

      // Debt value: 1000 * 1 = 1000
      // Liquidation threshold: 0.80
      // Min collateral value: 1000 / 0.80 = 1250
      // Min collateral amount: 1250 / 2500 = 0.5
      // Max withdrawable: 1.5 - 0.5 = 1.0
      expect(maxWithdrawable.toString()).toBe('1');
    });

    test('should return 0 when position is at liquidation threshold', () => {
      const position = {
        collateralAsset: 'ETH',
        debtAsset: 'USDC',
        collateralAmount: '0.5',
        debtAmount: '1000',
      };
      const prices = { ETH: '2500', USDC: '1' };

      const maxWithdrawable = vesuService.calculateMaxWithdrawable(position, prices);

      expect(maxWithdrawable.toString()).toBe('0');
    });
  });

  describe('vToken Calculations', () => {
    test('should calculate vTokens to receive', () => {
      const supplyAmount = new Decimal('1.5');
      const exchangeRate = new Decimal('1.02');

      const vTokens = vesuService.calculateVTokensToReceive(supplyAmount, exchangeRate);

      // vTokens = 1.5 / 1.02 = 1.470588...
      expect(vTokens.toFixed(6)).toBe('1.470588');
    });

    test('should calculate underlying value from vTokens', () => {
      const vTokenAmount = new Decimal('1.470588');
      const exchangeRate = new Decimal('1.02');

      const underlyingValue = vesuService.calculateUnderlyingValue(vTokenAmount, exchangeRate);

      // underlyingValue = 1.470588 * 1.02 = 1.499999... (rounds down to 1.499)
      expect(underlyingValue.toFixed(3)).toBe('1.499');
    });
  });

  describe('Validation Methods', () => {
    describe('validateAmount', () => {
      test('should accept valid positive amounts', () => {
        const amount = vesuService.validateAmount('100.5');
        expect(amount.toString()).toBe('100.5');
      });

      test('should reject zero amount', () => {
        expect(() => {
          vesuService.validateAmount('0');
        }).toThrow(VesuError);
      });

      test('should reject negative amount', () => {
        expect(() => {
          vesuService.validateAmount('-10');
        }).toThrow(VesuError);
      });

      test('should reject non-numeric amount', () => {
        expect(() => {
          vesuService.validateAmount('abc');
        }).toThrow(VesuError);
      });

      test('should reject excessively large amount', () => {
        expect(() => {
          vesuService.validateAmount('1e37');
        }).toThrow(VesuError);
      });
    });

    describe('validateAddress', () => {
      test('should accept valid Starknet address', () => {
        const address = '0x1234567890abcdef';
        const result = vesuService.validateAddress(address);
        expect(result).toBe(address);
      });

      test('should reject address without 0x prefix', () => {
        expect(() => {
          vesuService.validateAddress('1234567890abcdef');
        }).toThrow(VesuError);
      });

      test('should reject non-hex address', () => {
        expect(() => {
          vesuService.validateAddress('0xGHIJKL');
        }).toThrow(VesuError);
      });

      test('should reject null address', () => {
        expect(() => {
          vesuService.validateAddress(null);
        }).toThrow(VesuError);
      });
    });

    describe('validateAsset', () => {
      test('should accept supported assets', () => {
        expect(() => {
          vesuService.validateAsset('ETH');
        }).not.toThrow();

        expect(() => {
          vesuService.validateAsset('USDC');
        }).not.toThrow();

        expect(() => {
          vesuService.validateAsset('STRK');
        }).not.toThrow();
      });

      test('should reject unsupported assets', () => {
        expect(() => {
          vesuService.validateAsset('INVALID');
        }).toThrow(VesuError);
      });
    });
  });

  describe('Error Handling', () => {
    test('VesuError should contain code and details', () => {
      const error = new VesuError(
        ErrorCodes.INVALID_AMOUNT,
        'Test error message',
        { field: 'amount', value: '0' }
      );

      expect(error.code).toBe(ErrorCodes.INVALID_AMOUNT);
      expect(error.message).toBe('Test error message');
      expect(error.details).toEqual({ field: 'amount', value: '0' });
      expect(error.name).toBe('VesuError');
    });
  });
});
