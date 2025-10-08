// Atomiq SDK Integration using @atomiqlabs/sdk
import { AtomiqSDK } from '@atomiqlabs/sdk';
import { xverseWallet } from './xverse';

export interface SwapParams {
  fromToken: string; // 'BTC', 'ETH', 'STRK'
  toToken: string;
  amount: string;
  slippage?: number;
}

export interface SwapResult {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  details: any;
}

export interface SwapQuote {
  fromAmount: string;
  toAmount: string;
  exchangeRate: string;
  fee: string;
  slippage: number;
  estimatedTime: string;
}

// Initialize Atomiq SDK with real implementation
export const atomiq = new AtomiqSDK({
  environment: (process.env.ATOMIQ_SDK_ENV as 'testnet' | 'mainnet') || 'testnet',
  signer: xverseWallet
});

// Export utility functions using real SDK
export const getSwapQuote = async (params: SwapParams): Promise<SwapQuote> => {
  try {
    const quote = await atomiq.getQuote({
      fromToken: params.fromToken,
      toToken: params.toToken,
      amount: params.amount,
      slippage: params.slippage
    });

    return {
      fromAmount: params.amount,
      toAmount: quote.toAmount,
      exchangeRate: quote.exchangeRate,
      fee: quote.fee,
      slippage: quote.slippage,
      estimatedTime: quote.estimatedTime
    };
  } catch (error) {
    throw new Error('Failed to get swap quote');
  }
};

// Add swap method to atomiq instance for compatibility
(atomiq as any).swap = async (params: SwapParams): Promise<SwapResult> => {
  try {
    // Check if wallet is connected
    const isConnected = await xverseWallet.isConnected();
    if (!isConnected) {
      throw new Error('Xverse wallet not connected');
    }

    const result = await atomiq.swap(params);

    return {
      txHash: result.txHash,
      status: result.status,
      details: result.details
    };
  } catch (error) {
    return {
      txHash: '',
      status: 'failed',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
};

export const checkSwapStatus = async (txHash: string): Promise<'pending' | 'confirmed' | 'failed'> => {
  try {
    return await atomiq.getSwapStatus(txHash);
  } catch (error) {
    return 'failed';
  }
};

export const cancelPendingSwap = async (txHash: string): Promise<boolean> => {
  try {
    return await atomiq.cancelSwap(txHash);
  } catch (error) {
    return false;
  }
};