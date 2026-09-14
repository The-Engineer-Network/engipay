"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * There is no separate sign-up: the wallet is the account. "Get started"
 * either goes straight into the app, or opens the wallet sheet. The redirect
 * after connecting lives in WalletContext, so it works from any public page.
 */
export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const router = useRouter();
  const { isConnected, connectWallet } = useWallet();

  useEffect(() => {
    if (!isOpen) return;
    if (isConnected) router.push("/dashboard");
    else connectWallet();
    onClose();
  }, [isOpen, isConnected, connectWallet, onClose, router]);

  return null;
}
