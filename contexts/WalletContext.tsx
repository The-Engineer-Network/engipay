"use client";

import React, { createContext, useContext, useCallback, useMemo, useState, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount, useDisconnect, useBalance, useChainId } from "wagmi";
import { formatUnits } from "viem";
import { toast } from "@/hooks/use-toast";
import type { Balance } from "@/types/dashboard";
import { TRACKED_TOKENS } from "@/lib/tokens";
import { useTokenBalances } from "@/hooks/use-token-balances";
import { WalletSheet } from "@/components/wallet/WalletSheet";
import { useStellarWallet } from "@/contexts/StellarWalletContext";

interface WalletContextType {
  /** True when any wallet is connected: an EVM wallet, Freighter on Stellar, or both. */
  isConnected: boolean;
  /** The EVM address when one is connected, otherwise the Stellar address. */
  walletAddress: string | null;
  evmAddress: string | null;
  stellarAddress: string | null;
  /** Name of the connected wallet, e.g. "MetaMask", "Rainbow", "Coinbase Wallet". */
  walletName: string | null;
  isConnecting: boolean;
  balances: Balance[];
  isLoadingBalances: boolean;
  chainId: number;
  connectWallet: () => void;
  disconnectWallet: () => void;
  openWalletModal: () => void;
  closeWalletModal: () => void;
  refetchBalances: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}

/**
 * One `useWallet()` entry point over two wallets: wagmi/RainbowKit for Base,
 * and Freighter for Stellar. Balances from both appear together, because a
 * person thinks in what they hold, not in which network holds it.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, isConnecting, isReconnecting, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const [sheetOpen, setSheetOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const chainId = useChainId();
  const stellar = useStellarWallet();

  const { data: nativeBalance, isLoading: isLoadingNative } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });

  const {
    balances: tokenBalances,
    isLoading: isLoadingTokens,
    refetch: refetchTokens,
  } = useTokenBalances(address);

  const balances = useMemo<Balance[]>(() => {
    const out: Balance[] = [];

    if (nativeBalance && nativeBalance.value > 0n) {
      out.push({
        symbol: nativeBalance.symbol,
        name: "Ether",
        balance: Number(formatUnits(nativeBalance.value, nativeBalance.decimals)).toFixed(4),
        value: "$0.00",
        change: "+0.0%",
        icon: "\u{1F537}",
        trend: "stable",
        volume: "On-chain",
      });
    }

    for (const token of TRACKED_TOKENS) {
      const raw = tokenBalances[token.address.toLowerCase()];
      if (!raw || raw === 0n) continue;
      out.push({
        symbol: token.symbol,
        name: token.name,
        balance: Number(formatUnits(raw, token.decimals)).toFixed(token.decimals === 6 ? 2 : 4),
        value: "$0.00",
        change: "+0.0%",
        icon: token.icon,
        trend: "stable",
        volume: "On-chain",
      });
    }

    if (stellar.balances?.funded) {
      out.push({
        symbol: "XLM",
        name: "Stellar Lumens",
        balance: Number(stellar.balances.xlm).toFixed(2),
        value: "$0.00",
        change: "+0.0%",
        icon: "\u{2728}",
        trend: "stable",
        volume: "On-chain",
      });
      if (stellar.balances.usdc !== null) {
        out.push({
          symbol: "USDC",
          name: "USD Coin on Stellar",
          balance: Number(stellar.balances.usdc).toFixed(2),
          value: "$0.00",
          change: "+0.0%",
          icon: "\u{1F4B5}",
          trend: "stable",
          volume: "On-chain",
        });
      }
    }

    return out;
  }, [nativeBalance, tokenBalances, stellar.balances]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    stellar.disconnectStellar();
    localStorage.removeItem("engipay-token");
    localStorage.removeItem("engipay-user");
    toast({ title: "Wallet disconnected" });
  }, [disconnect, stellar]);

  const connectWallet = useCallback(() => setSheetOpen(true), []);

  // Connecting from a public page means the visitor wants the app.
  const handleConnected = useCallback(() => {
    toast({ title: "Wallet connected" });
    const inApp = pathname?.startsWith("/dashboard") ||
      ["/send", "/receive", "/scan", "/convert", "/buy", "/sell", "/activity", "/settings"].some(
        (route) => pathname?.startsWith(route)
      );
    if (!inApp) router.push("/dashboard");
  }, [pathname, router]);

  const value: WalletContextType = {
    isConnected: isConnected || stellar.isStellarConnected,
    walletAddress: address ?? stellar.stellarAddress,
    evmAddress: address ?? null,
    stellarAddress: stellar.stellarAddress,
    walletName: connector?.name ?? stellar.stellarWalletName,
    isConnecting: isConnecting || isReconnecting,
    balances,
    isLoadingBalances:
      (Boolean(address) && (isLoadingNative || isLoadingTokens)) ||
      (stellar.isStellarConnected && stellar.isLoadingBalances),
    chainId,
    connectWallet,
    disconnectWallet,
    openWalletModal: connectWallet,
    closeWalletModal: () => setSheetOpen(false),
    refetchBalances: () => {
      refetchTokens();
      stellar.refetchStellarBalances();
    },
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletSheet open={sheetOpen} onOpenChange={setSheetOpen} onConnected={handleConnected} />
    </WalletContext.Provider>
  );
}
