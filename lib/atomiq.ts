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

// Atomiq SDK instance (lazy initialized)
let atomiqInstance: any = null;

// Initialize Atomiq SDK with real implementation
export const initAtomiqSDK = () => {
  if (typeof window === 'undefined') return null;
  
  if (atomiqInstance) return atomiqInstance;
  
  try {
    atomiqInstance = new AtomiqSDK({
      environment: (process.env.NEXT_PUBLIC_ATOMIQ_SDK_ENV as 'testnet' | 'mainnet') || 'testnet',
      signer: xverseWallet
    });
    return atomiqInstance;
  } catch (error) {
    console.error('Failed to initialize AtomiqSDK:', error);
    return null;
  }
};

// Export atomiq with safe getter
export const getAtomiq = () => {
  if (!atomiqInstance) {
    atomiqInstance = initAtomiqSDK();
  }
  return atomiqInstance;
};

// Export utility functions using real SDK
export const getSwapQuote = async (params: SwapParams): Promise<SwapQuote> => {
  try {
    const atomiq = getAtomiq();
    if (!atomiq) {
      throw new Error('Atomiq SDK not initialized');
    }

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
    console.error('Failed to get swap quote:', error);
    throw new Error('Failed to get swap quote');
  }
};

export const executeSwap = async (params: SwapParams): Promise<SwapResult> => {
  try {
    const atomiq = getAtomiq();
    if (!atomiq) {
      throw new Error('Atomiq SDK not initialized');
    }

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
    console.error('Swap failed:', error);
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
    const atomiq = getAtomiq();
    if (!atomiq) return 'failed';
    
    return await atomiq.getSwapStatus(txHash);
  } catch (error) {
    console.error('Failed to check swap status:', error);
    return 'failed';
  }
};

export const cancelPendingSwap = async (txHash: string): Promise<boolean> => {
  try {
    const atomiq = getAtomiq();
    if (!atomiq) return false;
    
    return await atomiq.cancelSwap(txHash);
  } catch (error) {
    console.error('Failed to cancel swap:', error);
    return false;
  }
};