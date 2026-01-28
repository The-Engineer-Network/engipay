"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { ethers } from "ethers";
import { toast } from "@/hooks/use-toast";

interface WalletContextType {
  isConnected: boolean;
  walletAddress: string | null;
  walletName: string | null;
  isConnecting: boolean;
  balances: any[];
  isLoadingBalances: boolean;
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

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [balances, setBalances] = useState<any[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  // Check for existing connection on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem("engipay-wallet");
    if (savedWallet) {
      const { address, name } = JSON.parse(savedWallet);
      setWalletAddress(address);
      setWalletName(name);
      setIsConnected(true);
    }

    // Listen for account changes
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", handleAccountsChanged);
      window.ethereum.on("chainChanged", handleChainChanged);
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener(
          "accountsChanged",
          handleAccountsChanged
        );
        window.ethereum.removeListener("chainChanged", handleChainChanged);
      }
    };
  }, []);

  const handleAccountsChanged = (accounts: string[]) => {
    if (accounts.length === 0) {
      disconnectWallet();
    } else {
      setWalletAddress(accounts[0]);
      localStorage.setItem(
        "engipay-wallet",
        JSON.stringify({
          address: accounts[0],
          name: walletName,
        })
      );
    }
  };

  const handleChainChanged = () => {
    window.location.reload();
  };

  const checkWalletInstalled = (walletName: string): boolean => {
    switch (walletName) {
      case "MetaMask":
        return (
          typeof window !== "undefined" &&
          !!window.ethereum &&
          window.ethereum.isMetaMask
        );
      case "Argent":
        return (
          typeof window !== "undefined" &&
          !!window.ethereum &&
          window.ethereum.isArgent
        );
      case "Braavos":
        return (
          typeof window !== "undefined" &&
          !!window.ethereum &&
          window.ethereum.isBraavos
        );
      case "Xverse":
        // Xverse is a browser extension, check if available
        return typeof window !== "undefined" && !!window.xverse;
      default:
        return false;
    }
  };

  const connectWallet = async (walletName: string) => {
    if (!checkWalletInstalled(walletName)) {
      toast({
        title: "Wallet not found",
        description: `${walletName} is not installed. Please download ${walletName} wallet to continue.`,
        action: (
          <a
            href={getWalletDownloadUrl(walletName)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
          >
            Download {walletName}
          </a>
        ),
      });
      return;
    }

    setIsConnecting(true);

    try {
      if (walletName === "Xverse") {
        // Handle Xverse BTC wallet connection
        const { xverseWallet } = await import("@/lib/xverse");
        const connected = await xverseWallet.connect();
        if (!connected) {
          throw new Error("Failed to connect to Xverse wallet");
        }

        // Get real BTC address from Xverse wallet
        // The xverseWallet.connect() sets the address internally
        // We need to access it - assuming it has a getAddress method or property
        const address = xverseWallet.address; // Get the real address
        if (!address) {
          throw new Error("Failed to get wallet address");
        }

        setWalletAddress(address);
        setWalletName(walletName);
        setIsConnected(true);
        setShowWalletModal(false);

        // Persist connection
        localStorage.setItem(
          "engipay-wallet",
          JSON.stringify({
            address,
            name: walletName,
          })
        );

        toast({
          title: "Xverse Wallet connected",
          description: "Successfully connected to Xverse Bitcoin wallet",
        });

        // Register wallet connection with backend
        try {
          await fetch('/api/auth/wallet-connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet_address: address,
              wallet_type: 'xverse'
            })
          });
        } catch (err) {
          console.error('Failed to register wallet with backend:', err);
        }

        // Fetch balances after connection
        await fetchBalances();
      } else {
        // Handle Ethereum wallets
        if (!window.ethereum) {
          throw new Error("No Ethereum provider found");
        }

        // Request account access
        const accounts = await window.ethereum.request({
          method: "eth_requestAccounts",
        });

        if (accounts.length === 0) {
          throw new Error("No accounts found");
        }

        const address = accounts[0];
        setWalletAddress(address);
        setWalletName(walletName);
        setIsConnected(true);
        setShowWalletModal(false);

        // Persist connection
        localStorage.setItem(
          "engipay-wallet",
          JSON.stringify({
            address,
            name: walletName,
          })
        );

        toast({
          title: "Wallet connected",
          description: `Successfully connected to ${walletName}`,
        });

        // Register wallet connection with backend
        try {
          await fetch('/api/auth/wallet-connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet_address: address,
              wallet_type: walletName.toLowerCase()
            })
          });
        } catch (err) {
          console.error('Failed to register wallet with backend:', err);
        }

        // Fetch balances after connection
        await fetchBalances();
      }
    } catch (error: any) {
      console.error("Wallet connection error:", error);
      toast({
        title: "Connection failed",
        description:
          error.message || "Failed to connect wallet. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const getWalletDownloadUrl = (walletName: string): string => {
    switch (walletName) {
      case "MetaMask":
        return "https://metamask.io/download/";
      case "Argent":
        return "https://argent.xyz/download";
      case "Braavos":
        return "https://braavos.app/download";
      case "Xverse":
        return "https://www.xverse.app/download";
      default:
        return "#";
    }
  };

  const fetchBalances = async () => {
    if (!walletAddress) return;

    setIsLoadingBalances(true);
    try {
      const balances = [];

      if (walletName === "Xverse") {
        // Fetch BTC balance from Xverse
        const { getBitcoinBalance } = await import("@/lib/xverse");
        const btcBalance = await getBitcoinBalance();
        const btcAmount = btcBalance.total / 100000000; // Convert satoshis to BTC

        if (btcAmount > 0) {
          balances.push({
            symbol: "BTC",
            name: "Bitcoin",
            balance: btcAmount.toFixed(8),
            value: "$0.00", // Would need price API for real values
            change: "+0.0%",
            icon: "₿",
            trend: "stable" as const,
            volume: "Real balance"
          });
        }
      } else if (window.ethereum) {
        // Fetch Ethereum balances
        const provider = new ethers.BrowserProvider(window.ethereum);

        // Common token contracts (Ethereum mainnet)
        const tokens = [
          {
            symbol: "ETH",
            name: "Ethereum",
            address: null, // Native ETH
            decimals: 18,
            icon: "🔷"
          },
          {
            symbol: "USDT",
            name: "Tether",
            address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT contract
            decimals: 6,
            icon: "💵"
          },
          {
            symbol: "USDC",
            name: "USD Coin",
            address: "0xA0b86a33E6441e88C5F2712C3E9b74F63F8F8E8b", // USDC contract
            decimals: 6,
            icon: "💰"
          }
        ];

        for (const token of tokens) {
          try {
            let balance;
            if (token.address === null) {
              // Native ETH balance
              balance = await provider.getBalance(walletAddress);
            } else {
              // ERC-20 token balance
              const contract = new ethers.Contract(
                token.address,
                ["function balanceOf(address) view returns (uint256)"],
                provider
              );
              balance = await contract.balanceOf(walletAddress);
            }

            const formattedBalance = ethers.formatUnits(balance, token.decimals);
            const numericBalance = parseFloat(formattedBalance);

            if (numericBalance > 0) {
              balances.push({
                symbol: token.symbol,
                name: token.name,
                balance: numericBalance.toFixed(token.decimals === 18 ? 4 : 2),
                value: "$0.00", // Would need price API for real values
                change: "+0.0%",
                icon: token.icon,
                trend: "stable" as const,
                volume: "Real balance"
              });
            }
          } catch (error) {
            console.error(`Error fetching ${token.symbol} balance:`, error);
          }
        }
      }

      setBalances(balances);
    } catch (error) {
      console.error("Error fetching balances:", error);
      toast({
        title: "Error",
        description: "Failed to fetch wallet balances",
        variant: "destructive",
      });
    } finally {
      setIsLoadingBalances(false);
    }
  };

  const disconnectWallet = () => {
    setIsConnected(false);
    setWalletAddress(null);
    setWalletName(null);
    setBalances([]);
    localStorage.removeItem("engipay-wallet");
    toast({
      title: "Wallet disconnected",
      description: "Your wallet has been disconnected",
    });
  };

  const openWalletModal = () => setShowWalletModal(true);
  const closeWalletModal = () => setShowWalletModal(false);

  const value: WalletContextType = {
    isConnected,
    walletAddress,
    walletName,
    isConnecting,
    balances,
    isLoadingBalances,
    connectWallet,
    disconnectWallet,
    openWalletModal,
    closeWalletModal,
    showWalletModal,
    checkWalletInstalled,
    fetchBalances,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

// Extend window interface for TypeScript
declare global {
  interface Window {
    ethereum?: any;
    xverse?: any;
  }
}
