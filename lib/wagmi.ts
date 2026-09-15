import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  argentWallet,
  binanceWallet,
  bitgetWallet,
  bybitWallet,
  coinbaseWallet,
  imTokenWallet,
  injectedWallet,
  ledgerWallet,
  metaMaskWallet,
  okxWallet,
  phantomWallet,
  rabbyWallet,
  rainbowWallet,
  safeWallet,
  safepalWallet,
  tokenPocketWallet,
  trustWallet,
  uniswapWallet,
  walletConnectWallet,
  zerionWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { base, baseSepolia } from "wagmi/chains";

/**
 * WalletConnect project id, from https://cloud.reown.com.
 * Without it, injected browser wallets still work (they are discovered via
 * EIP-6963) but mobile wallets that connect over WalletConnect will not.
 */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

if (!projectId && typeof window !== "undefined") {
  console.warn(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set — mobile wallets will be unavailable."
  );
}

/** Testnet during development, Base mainnet in production. */
export const activeChain =
  process.env.NEXT_PUBLIC_CHAIN_ENV === "mainnet" ? base : baseSepolia;

/**
 * Wallet list. Any wallet the browser has installed is discovered
 * automatically through EIP-6963 and appears first, so this list is about
 * reach: the wallets Nigerian users actually hold, plus the long tail.
 */
const wallets = [
  {
    groupName: "Popular",
    wallets: [
      metaMaskWallet,
      trustWallet,
      coinbaseWallet,
      binanceWallet,
      walletConnectWallet,
    ],
  },
  {
    groupName: "More wallets",
    wallets: [
      rainbowWallet,
      okxWallet,
      bitgetWallet,
      bybitWallet,
      rabbyWallet,
      zerionWallet,
      uniswapWallet,
      phantomWallet,
      safepalWallet,
      tokenPocketWallet,
      imTokenWallet,
      argentWallet,
      ledgerWallet,
      safeWallet,
      injectedWallet,
    ],
  },
];

/**
 * RainbowKit's default config wires up EIP-6963 discovery, WalletConnect v2
 * for mobile, Coinbase Wallet and Safe.
 */
export const wagmiConfig = getDefaultConfig({
  appName: "EngiPay",
  projectId: projectId || "00000000000000000000000000000000",
  chains: [activeChain],
  wallets,
  ssr: true,
});
