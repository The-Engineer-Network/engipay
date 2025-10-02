"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  Shield,
  Zap,
  ArrowRightLeft,
  Bitcoin,
  ExternalLink,
  CheckCircle,
  TrendingUp,
  Download,
} from "lucide-react";
import { useWallet } from "@/contexts/WalletContext";

interface WalletConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalletConnectModal({
  open,
  onOpenChange,
}: WalletConnectModalProps) {
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const router = useRouter();
  const { connectWallet, isConnecting, checkWalletInstalled } = useWallet();

  const wallets = [
    {
      name: "MetaMask",
      icon: "🦊",
      popular: true,
    },
    {
      name: "Argent",
      icon: "🛡️",
    },
    {
      name: "Braavos",
      icon: "⚡",
    },
    {
      name: "Xverse",
      icon: "₿",
      popular: false,
    },
  ];

  const features = [
    {
      icon: <Shield className="w-5 h-5" />,
      title: "Secure",
    },
    {
      icon: <Zap className="w-5 h-5" />,
      title: "Instant Payments",
    },
    {
      icon: <ArrowRightLeft className="w-5 h-5" />,
      title: "Cross-Chain Swaps",
    },
    {
      icon: <TrendingUp className="w-5 h-5" />,
      title: "DeFi Access",
    },
  ];

  const handleWalletConnect = async (walletName: string) => {
    try {
      await connectWallet(walletName);
      setConnectedWallet(walletName);
      setTimeout(() => {
        window.location.href = "/dashboard";
        onOpenChange(false);
        setConnectedWallet(null);
      }, 2000);
    } catch (error) {
      // Error is handled in the context
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border border-green-500/30 max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto p-0 shadow-2xl shadow-green-500/20">
        {/* Header */}
        <div className="p-6 border-b border-green-500/20">
          <DialogHeader>
            <div className="flex items-center justify-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30">
                <Wallet className="w-5 h-5 text-black" />
              </div>
              <DialogTitle className="text-2xl font-bold text-green-400">
                Connect Wallet
              </DialogTitle>
            </div>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-6">
          {/* Connection Success */}
          {connectedWallet && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-6 text-center">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <h3 className="text-xl font-bold text-green-400 mb-1">
                Connected!
              </h3>
              <p className="text-green-300/80">{connectedWallet}</p>
            </div>
          )}

          {/* Wallet Options */}
          {!connectedWallet && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-green-400">
                  Choose Wallet
                </h3>
                {wallets.map((wallet) => (
                  <Button
                    key={wallet.name}
                    onClick={() => handleWalletConnect(wallet.name)}
                    disabled={isConnecting}
                    className={`w-full h-12 transition-all duration-200 flex items-center justify-between p-4 ${
                      checkWalletInstalled(wallet.name)
                        ? "bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 hover:border-green-500/50 text-green-300 hover:text-green-200"
                        : "bg-gray-500/10 hover:bg-gray-500/20 border border-gray-500/30 hover:border-gray-500/50 text-gray-400 hover:text-gray-300"
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                        <span className="text-lg leading-none">
                          {wallet.icon}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold">{wallet.name}</span>
                        {wallet.popular && (
                          <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs">
                            Popular
                          </Badge>
                        )}
                        {!checkWalletInstalled(wallet.name) && (
                          <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-xs">
                            Not Installed
                          </Badge>
                        )}
                      </div>
                    </div>
                    {checkWalletInstalled(wallet.name) ? (
                      <ExternalLink className="w-4 h-4 text-green-400" />
                    ) : (
                      <Download className="w-4 h-4 text-orange-400" />
                    )}
                  </Button>
                ))}

                {isConnecting && (
                  <div className="text-center py-3">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
                    <p className="text-green-300 mt-2 text-sm">Connecting...</p>
                  </div>
                )}
              </div>

              {/* Features */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-green-400">
                  Features
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {features.map((feature, index) => (
                    <div
                      key={index}
                      className="flex items-center space-x-2 p-3 bg-green-500/5 border border-green-500/20 rounded-lg"
                    >
                      <div className="text-green-400">{feature.icon}</div>
                      <span className="text-sm font-medium text-green-300">
                        {feature.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Security Notice */}
          {!connectedWallet && (
            <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-center space-x-3">
                <Shield className="w-5 h-5 text-green-400 flex-shrink-0" />
                <p className="text-sm text-green-300/80">
                  Your keys never leave your wallet. Fully secure.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
