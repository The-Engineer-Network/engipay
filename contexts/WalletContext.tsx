"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { ethers } from "ethers";
import { toast } from "@/hooks/use-toast";
import type { AccountInterface } from "starknet";
import type { Balance } from "@/types/dashboard";

type WalletKind = "MetaMask" | "Argent" | "ArgentX" | "Braavos" | "Xverse";

interface WalletContextType {
  isConnected: boolean;
  walletAddress: string | null;
  walletName: string | null;
  isConnecting: boolean;
  balances: Balance[];
  isLoadingBalances: boolean;
  /** Starknet account used to sign transactions. Null unless a Starknet
   *  wallet (Argent/Braavos) is connected. Payment and escrow components
   *  require this. */
  starknetAccount: AccountInterface | null;
  /** Alias kept for components that read `account`. */
  account: AccountInterface | null;
  connectWallet: (walletName: string) => Promise<void>;
  disconnectWallet: () => void;
  openWalletModal: () => void;
  closeWalletModal: () => void;
  showWalletModal: boolean;
  checkWalletInstalled: (walletName: string) => boolean;
  fetchBalances: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}

const STARKNET_WALLETS = new Set(["Argent", "ArgentX", "Braavos"]);

const STARKNET_RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC_URL ||
  "https://starknet-sepolia.public.blastapi.io/rpc/v0_7";

/** Sepolia token addresses; override per-network via env. */
const STARKNET_TOKENS = [
  {
    symbol: "ETH",
    name: "Ethereum",
    address:
      process.env.NEXT_PUBLIC_ERC20_ETH_ADDRESS ||
      "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    decimals: 18,
    icon: "\u{1F537}",
  },
  {
    symbol: "STRK",
    name: "Starknet Token",
    address:
      process.env.NEXT_PUBLIC_ERC20_STRK_ADDRESS ||
      "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    decimals: 18,
    icon: "⭐",
  },
];

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
];

function getWalletDownloadUrl(walletName: string): string {
  switch (walletName) {
    case "MetaMask":
      return "https://metamask.io/download/";
    case "Argent":
    case "ArgentX":
      return "https://www.argent.xyz/argent-x/";
    case "Braavos":
      return "https://braavos.app/download-braavos-wallet/";
    case "Xverse":
      return "https://www.xverse.app/download";
    default:
      return "#";
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [starknetAccount, setStarknetAccount] = useState<AccountInterface | null>(null);

  /**
   * Balance loading takes the address and wallet explicitly rather than
   * reading state. The previous version called this immediately after
   * setWalletAddress(), so it closed over the stale `null` address and always
   * bailed out at the guard — balances never loaded on first connect.
   */
  const loadBalances = useCallback(async (address: string, kind: string | null) => {
    if (!address) return;
    setIsLoadingBalances(true);
    const next: Balance[] = [];

    try {
      if (kind && STARKNET_WALLETS.has(kind)) {
        const { RpcProvider, Contract, uint256 } = await import("starknet");
        const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });

        for (const token of STARKNET_TOKENS) {
          try {
            const contract = new Contract({
              abi: ERC20_BALANCE_ABI as any,
              address: token.address,
              providerOrAccount: provider,
            });
            const raw: any = await contract.call("balanceOf", [address]);
            const value = raw?.balance ?? raw;
            const asBigInt =
              typeof value === "object" && value !== null && "low" in value
                ? uint256.uint256ToBN(value as any)
                : BigInt(value?.toString?.() ?? "0");

            const amount = Number(asBigInt) / 10 ** token.decimals;
            if (amount > 0) {
              next.push({
                symbol: token.symbol,
                name: token.name,
                balance: amount.toFixed(4),
                value: "$0.00",
                change: "+0.0%",
                icon: token.icon,
                trend: "stable",
                volume: "On-chain",
              });
            }
          } catch (error) {
            console.error(`Error fetching ${token.symbol} balance:`, error);
          }
        }
      } else if (kind === "Xverse") {
        const { getBitcoinBalance } = await import("@/lib/xverse");
        const btc = await getBitcoinBalance();
        const amount = btc.total / 100_000_000;
        if (amount > 0) {
          next.push({
            symbol: "BTC",
            name: "Bitcoin",
            balance: amount.toFixed(8),
            value: "$0.00",
            change: "+0.0%",
            icon: "₿",
            trend: "stable",
            volume: "On-chain",
          });
        }
      } else if (typeof window !== "undefined" && window.ethereum) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const wei = await provider.getBalance(address);
        const amount = Number.parseFloat(ethers.formatUnits(wei, 18));
        if (amount > 0) {
          next.push({
            symbol: "ETH",
            name: "Ethereum",
            balance: amount.toFixed(4),
            value: "$0.00",
            change: "+0.0%",
            icon: "\u{1F537}",
            trend: "stable",
            volume: "On-chain",
          });
        }
      }

      setBalances(next);
    } catch (error) {
      console.error("Error fetching balances:", error);
      toast({
        title: "Could not load balances",
        description: "Your wallet is connected, but balances are unavailable right now.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingBalances(false);
    }
  }, []);

  const fetchBalances = useCallback(
    () => loadBalances(walletAddress ?? "", walletName),
    [loadBalances, walletAddress, walletName]
  );

  const disconnectWallet = useCallback(() => {
    setIsConnected(false);
    setWalletAddress(null);
    setWalletName(null);
    setStarknetAccount(null);
    setBalances([]);
    localStorage.removeItem("engipay-wallet");
    localStorage.removeItem("engipay-token");
    localStorage.removeItem("engipay-user");
    toast({ title: "Wallet disconnected" });
  }, []);

  /** Restore a previous session. Reconnects silently so `starknetAccount` is
   *  available again after a page refresh, which payments depend on. */
  useEffect(() => {
    const saved = localStorage.getItem("engipay-wallet");
    if (!saved) return;

    let cancelled = false;
    (async () => {
      try {
        const { address, name } = JSON.parse(saved);
        if (cancelled || !address) return;

        setWalletAddress(address);
        setWalletName(name);
        setIsConnected(true);

        if (STARKNET_WALLETS.has(name)) {
          const { connect } = await import("get-starknet");
          const wallet: any = await connect({ modalMode: "neverAsk" });
          if (!cancelled && wallet?.account) setStarknetAccount(wallet.account);
        }

        if (!cancelled) void loadBalances(address, name);
      } catch (error) {
        console.error("Failed to restore wallet session:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadBalances]);

  /** Account/chain change listeners for EVM wallets. */
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    const onAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnectWallet();
      } else {
        setWalletAddress(accounts[0]);
        localStorage.setItem(
          "engipay-wallet",
          JSON.stringify({ address: accounts[0], name: walletName })
        );
      }
    };
    const onChainChanged = () => window.location.reload();

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener("chainChanged", onChainChanged);
    };
  }, [walletName, disconnectWallet]);

  const checkWalletInstalled = useCallback((name: string): boolean => {
    if (typeof window === "undefined") return false;
    switch (name) {
      case "MetaMask":
        return !!window.ethereum?.isMetaMask;
      case "Argent":
      case "ArgentX":
        return !!(window.starknet_argentX || window.starknet?.id === "argentX");
      case "Braavos":
        return !!(window.starknet_braavos || window.starknet?.id === "braavos");
      case "Xverse":
        return !!window.xverse;
      default:
        return false;
    }
  }, []);

  /** Persist session and register the wallet with the backend. */
  const finalizeConnection = useCallback(
    async (address: string, name: string, sn: AccountInterface | null) => {
      setWalletAddress(address);
      setWalletName(name);
      setStarknetAccount(sn);
      setIsConnected(true);
      setShowWalletModal(false);
      localStorage.setItem("engipay-wallet", JSON.stringify({ address, name }));

      toast({ title: "Wallet connected", description: `Connected to ${name}.` });

      void loadBalances(address, name);

      try {
        const response = await fetch("/api/auth/wallet-connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet_address: address, wallet_type: name.toLowerCase() }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.token) {
            localStorage.setItem("engipay-token", data.token);
            localStorage.setItem("engipay-user", JSON.stringify(data.user));
          }
        }
      } catch (error) {
        // Non-fatal: the wallet is usable even if the backend is unreachable.
        console.error("Failed to register wallet with backend:", error);
      }
    },
    [loadBalances]
  );

  const connectWallet = useCallback(
    async (name: string) => {
      if (!checkWalletInstalled(name)) {
        toast({
          title: "Wallet not found",
          description: `${name} is not installed.`,
          action: (
            <a
              href={getWalletDownloadUrl(name)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Install {name}
            </a>
          ),
        });
        return;
      }

      setIsConnecting(true);
      try {
        if (name === "Xverse") {
          const { xverseWallet } = await import("@/lib/xverse");
          if (!(await xverseWallet.connect())) throw new Error("Failed to connect to Xverse.");
          const address = xverseWallet.address;
          if (!address) throw new Error("Could not read the Xverse wallet address.");
          await finalizeConnection(address, name, null);
        } else if (STARKNET_WALLETS.has(name)) {
          const { connect } = await import("get-starknet");
          const wallet: any = await connect({ modalMode: "canAsk", modalTheme: "dark" });
          if (!wallet) throw new Error(`${name} wallet not found.`);

          await wallet.enable?.();
          const address: string | undefined =
            wallet.selectedAddress || wallet.account?.address;
          if (!address) throw new Error("No account address found.");

          await finalizeConnection(address, name, wallet.account ?? null);
        } else {
          if (!window.ethereum) throw new Error("No Ethereum provider found.");
          const accounts: string[] = await window.ethereum.request({
            method: "eth_requestAccounts",
          });
          if (!accounts.length) throw new Error("No accounts found.");
          await finalizeConnection(accounts[0], name, null);
        }
      } catch (error: any) {
        console.error("Wallet connection error:", error);
        toast({
          title: "Connection failed",
          description: error?.message || "Could not connect the wallet. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsConnecting(false);
      }
    },
    [checkWalletInstalled, finalizeConnection]
  );

  const value: WalletContextType = {
    isConnected,
    walletAddress,
    walletName,
    isConnecting,
    balances,
    isLoadingBalances,
    starknetAccount,
    account: starknetAccount,
    connectWallet,
    disconnectWallet,
    openWalletModal: () => setShowWalletModal(true),
    closeWalletModal: () => setShowWalletModal(false),
    showWalletModal,
    checkWalletInstalled,
    fetchBalances,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

declare global {
  interface Window {
    ethereum?: any;
    xverse?: any;
    starknet?: any;
    starknet_argentX?: any;
    starknet_braavos?: any;
  }
}
