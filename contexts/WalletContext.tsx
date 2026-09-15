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

interface WalletContextType {
  isConnected: boolean;
  walletAddress: string | null;
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
 * Adapter over wagmi so the rest of the app keeps a single `useWallet()` entry
 * point. Wallet discovery, connection and session handling all live in
 * wagmi/RainbowKit — there is deliberately no hardcoded wallet list here.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, isConnecting, isReconnecting, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const [sheetOpen, setSheetOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const chainId = useChainId();

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

    return out;
  }, [nativeBalance, tokenBalances]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    localStorage.removeItem("engipay-token");
    localStorage.removeItem("engipay-user");
    toast({ title: "Wallet disconnected" });
  }, [disconnect]);

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
    isConnected,
    walletAddress: address ?? null,
    walletName: connector?.name ?? null,
    isConnecting: isConnecting || isReconnecting,
    balances,
    isLoadingBalances: isLoadingNative || isLoadingTokens,
    chainId,
    connectWallet,
    disconnectWallet,
    openWalletModal: connectWallet,
    closeWalletModal: () => setSheetOpen(false),
    refetchBalances: refetchTokens,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletSheet open={sheetOpen} onOpenChange={setSheetOpen} onConnected={handleConnected} />
    </WalletContext.Provider>
  );
}
