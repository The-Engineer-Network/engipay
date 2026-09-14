import type { Address } from "viem";
import { base, baseSepolia } from "wagmi/chains";

export interface TrackedToken {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  icon: string;
}

/** ERC20 tokens shown on the dashboard, per chain. */
const TOKENS_BY_CHAIN: Record<number, TrackedToken[]> = {
  [base.id]: [
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      icon: "\u{1F4B5}",
    },
  ],
  [baseSepolia.id]: [
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      decimals: 6,
      icon: "\u{1F4B5}",
    },
  ],
};

const CHAIN_ID =
  process.env.NEXT_PUBLIC_CHAIN_ENV === "mainnet" ? base.id : baseSepolia.id;

export const TRACKED_TOKENS: TrackedToken[] = TOKENS_BY_CHAIN[CHAIN_ID] ?? [];

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;
