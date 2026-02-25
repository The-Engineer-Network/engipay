/**
 * Tongo SDK - Frontend Integration
 * Privacy-shielded transactions with ElGamal encryption
 * https://docs.tongo.cash/
 */

import { TongoClient } from '@fatsolutions/tongo-sdk';

let tongoClient: TongoClient | null = null;

/**
 * Initialize Tongo client (lazy loading)
 */
export const getTongoClient = async (): Promise<TongoClient> => {
  if (tongoClient) return tongoClient;

  tongoClient = new TongoClient({
    rpcUrl: process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/Dij4b08u9UCGvFQ6sfgDP',
    network: (process.env.NEXT_PUBLIC_STARKNET_NETWORK as 'mainnet' | 'sepolia') || 'sepolia',
    tongoWrapperContract: process.env.NEXT_PUBLIC_TONGO_WRAPPER_CONTRACT,
    tongoTransferContract: process.env.NEXT_PUBLIC_TONGO_TRANSFER_CONTRACT,
  });

  await tongoClient.init();
  return tongoClient;
};

/**
 * Shield (wrap) ERC20 tokens with encryption
 */
export const shieldTokens = async (
  tokenAddress: string,
  amount: string,
  signer: any
): Promise<{
  tx_hash: string;
  encrypted_balance: string;
  explorer_url: string;
}> => {
  const client = await getTongoClient();

  const result = await client.shield({
    tokenAddress,
    amount: BigInt(amount),
    signer,
  });

  return {
    tx_hash: result.transaction_hash,
    encrypted_balance: result.encrypted_balance,
    explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
  };
};

/**
 * Private transfer with hidden amounts
 */
export const privateTransfer = async (
  tokenAddress: string,
  recipient: string,
  amount: string,
  signer: any,
  memo?: string
): Promise<{
  tx_hash: string;
  encrypted_amount: string;
  proof: any;
  explorer_url: string;
}> => {
  const client = await getTongoClient();

  const result = await client.privateTransfer({
    tokenAddress,
    recipient,
    amount: BigInt(amount),
    signer,
    memo: memo || '',
  });

  return {
    tx_hash: result.transaction_hash,
    encrypted_amount: result.encrypted_amount,
    proof: result.zero_knowledge_proof,
    explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
  };
};

/**
 * Unshield (unwrap) encrypted tokens back to ERC20
 */
export const unshieldTokens = async (
  tokenAddress: string,
  amount: string,
  signer: any
): Promise<{
  tx_hash: string;
  explorer_url: string;
}> => {
  const client = await getTongoClient();

  const result = await client.unshield({
    tokenAddress,
    amount: BigInt(amount),
    signer,
  });

  return {
    tx_hash: result.transaction_hash,
    explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
  };
};

/**
 * Generate viewing key for auditing
 */
export const generateViewingKey = async (
  signer: any
): Promise<{
  viewing_key: string;
  public_key: string;
  expires_at: string;
}> => {
  const client = await getTongoClient();

  const result = await client.generateViewingKey({ signer });

  return {
    viewing_key: result.key,
    public_key: result.public_key,
    expires_at: result.expires_at,
  };
};

/**
 * Get encrypted balance
 */
export const getEncryptedBalance = async (
  address: string,
  tokenAddress: string
): Promise<{
  encrypted_balance: string;
  public_key: string;
}> => {
  const client = await getTongoClient();

  const result = await client.getEncryptedBalance({
    address,
    tokenAddress,
  });

  return {
    encrypted_balance: result.encrypted_value,
    public_key: result.public_key,
  };
};

/**
 * Decrypt balance with viewing key
 */
export const decryptBalance = async (
  encryptedBalance: string,
  viewingKey: string
): Promise<string> => {
  const client = await getTongoClient();

  const result = await client.decryptBalance({
    encrypted_balance: encryptedBalance,
    viewing_key: viewingKey,
  });

  return result.amount.toString();
};

/**
 * Get supported tokens for privacy wrapping
 */
export const getSupportedTokens = async (): Promise<Array<{
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  tongo_wrapper: string;
}>> => {
  const client = await getTongoClient();

  try {
    const tokens = await client.getSupportedTokens();
    return tokens.map((token: any) => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      tongo_wrapper: token.wrapper_address,
    }));
  } catch (error) {
    // Return default tokens if API fails
    return [
      {
        address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        tongo_wrapper: process.env.NEXT_PUBLIC_TONGO_ETH_WRAPPER || '',
      },
      {
        address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
        symbol: 'STRK',
        name: 'StarkNet Token',
        decimals: 18,
        tongo_wrapper: process.env.NEXT_PUBLIC_TONGO_STRK_WRAPPER || '',
      },
      {
        address: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        tongo_wrapper: process.env.NEXT_PUBLIC_TONGO_USDC_WRAPPER || '',
      },
    ];
  }
};

/**
 * Verify zero-knowledge proof
 */
export const verifyProof = async (proof: any): Promise<boolean> => {
  const client = await getTongoClient();
  return await client.verifyProof(proof);
};
