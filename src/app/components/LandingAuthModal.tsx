"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { useWallet } from "@/contexts/WalletContext";
import { useRouter } from "next/navigation";

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
    const [activeTab, setActiveTab] = useState<"wallet" | "email">("wallet");
    const [authMode, setAuthMode] = useState<"login" | "signup">("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    
    const { connectWallet, isConnecting, checkWalletInstalled } = useWallet();
    const router = useRouter();

    // Prevent scrolling when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [isOpen]);

    const handleWalletConnect = async (walletName: string) => {
        try {
            await connectWallet(walletName);
            setTimeout(() => {
                router.push("/dashboard");
                onClose();
            }, 1500);
        } catch (error) {
            console.error("Wallet connection error:", error);
        }
    };

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            if (authMode === "signup") {
                if (password !== confirmPassword) {
                    setError("Passwords do not match");
                    setIsLoading(false);
                    return;
                }
                
                const response = await fetch("/api/auth/signup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password }),
                });

                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || "Signup failed");
                }

                // Store token
                localStorage.setItem("engipay-token", data.token);
                localStorage.setItem("engipay-user", JSON.stringify(data.user));
                
                router.push("/dashboard");
                onClose();
            } else {
                const response = await fetch("/api/auth/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password }),
                });

                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || "Login failed");
                }

                // Store token
                localStorage.setItem("engipay-token", data.token);
                localStorage.setItem("engipay-user", JSON.stringify(data.user));
                
                router.push("/dashboard");
                onClose();
            }
        } catch (err: any) {
            setError(err.message || "Authentication failed");
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-[440px] max-h-[90vh] bg-[#1A1A1A] border border-[#00BF6333] rounded-[24px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col">

                {/* Header */}
                <div className="pt-6 pb-3 px-6 text-center relative flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-4 text-white/40 hover:text-white transition-colors bg-transparent border-none cursor-pointer p-2 z-10"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>

                    <h2 className="text-xl font-bold text-white mb-1">Welcome to EngiPay</h2>
                    <p className="text-[#A0A0A0] text-xs">
                        {activeTab === "wallet" 
                            ? "Choose your preferred sign in method" 
                            : authMode === "login" 
                                ? "Sign in to your account" 
                                : "Create your account"}
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex border-y border-white/10 flex-shrink-0">
                    <button
                        className={`flex-1 py-2.5 text-xs font-semibold transition-all relative bg-transparent border-none cursor-pointer ${activeTab === "wallet" ? "text-[#00FF87]" : "text-[#A0A0A0]"
                            }`}
                        onClick={() => setActiveTab("wallet")}
                    >
                        Wallet Connect
                        {activeTab === "wallet" && (
                            <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#00FF87]" />
                        )}
                    </button>
                    <button
                        className={`flex-1 py-2.5 text-xs font-semibold transition-all relative bg-transparent border-none cursor-pointer ${activeTab === "email" ? "text-[#00FF87]" : "text-[#A0A0A0]"
                            }`}
                        onClick={() => setActiveTab("email")}
                    >
                        Email & Password
                        {activeTab === "email" && (
                            <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#00FF87]" />
                        )}
                    </button>
                </div>

                {/* Body with Scroll */}
                <div className="p-5 overflow-y-auto flex-1" style={{ maxHeight: 'calc(90vh - 140px)' }}>
                    {activeTab === "wallet" ? (
                        <div className="space-y-2.5">
                            {/* Wallet Buttons */}
                            <button 
                                onClick={() => handleWalletConnect("MetaMask")}
                                disabled={isConnecting}
                                className="w-full flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all group cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-[#00FF87] rounded-lg flex items-center justify-center">
                                        <span className="text-xs">🦊</span>
                                    </div>
                                    <span className="text-white text-sm font-semibold">MetaMask</span>
                                </div>
                                {!checkWalletInstalled("MetaMask") && (
                                    <span className="text-xs text-orange-400">Not Installed</span>
                                )}
                            </button>

                            <button 
                                onClick={() => handleWalletConnect("Argent")}
                                disabled={isConnecting}
                                className="w-full flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all group cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-[#00FF87] rounded-lg flex items-center justify-center">
                                        <span className="text-white font-bold">🛡️</span>
                                    </div>
                                    <span className="text-white text-sm font-semibold">Argent Wallet</span>
                                </div>
                                {!checkWalletInstalled("Argent") && (
                                    <span className="text-xs text-orange-400">Not Installed</span>
                                )}
                            </button>

                            <button 
                                onClick={() => handleWalletConnect("Braavos")}
                                disabled={isConnecting}
                                className="w-full flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all group cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-[#00FF87] rounded-lg flex items-center justify-center">
                                        <span className="text-white font-bold">⚡</span>
                                    </div>
                                    <span className="text-white text-sm font-semibold">Braavos Wallet</span>
                                </div>
                                {!checkWalletInstalled("Braavos") && (
                                    <span className="text-xs text-orange-400">Not Installed</span>
                                )}
                            </button>

                            <button 
                                onClick={() => handleWalletConnect("Xverse")}
                                disabled={isConnecting}
                                className="w-full flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all group cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-[#00FF87] rounded-lg flex items-center justify-center">
                                        <span className="text-white font-bold">₿</span>
                                    </div>
                                    <span className="text-white text-sm font-semibold">Xverse (Bitcoin)</span>
                                </div>
                                {!checkWalletInstalled("Xverse") && (
                                    <span className="text-xs text-orange-400">Not Installed</span>
                                )}
                            </button>

                            {isConnecting && (
                                <div className="text-center py-2">
                                    <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-[#00FF87]"></div>
                                    <p className="text-[#00FF87] mt-2 text-xs">Connecting...</p>
                                </div>
                            )}

                            {/* Footer text */}
                            <div className="pt-2 text-center">
                                <p className="text-[#A0A0A0] text-xs">
                                    Don't have a wallet?{" "}
                                    <button 
                                        onClick={() => setActiveTab("email")}
                                        className="text-[#00FF87] font-semibold bg-transparent border-none cursor-pointer hover:underline"
                                    >
                                        Sign up with email
                                    </button>
                                </p>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleEmailAuth} className="space-y-4">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-red-400 text-xs">
                                    {error}
                                </div>
                            )}
                            
                            <div className="space-y-3 text-left">
                                <div>
                                    <label className="block text-white text-xs font-semibold mb-1.5 ml-1">Email Address</label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="your@email.com"
                                        required
                                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-white text-sm placeholder:text-[#555] focus:outline-none focus:border-[#00FF87] transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-white text-xs font-semibold mb-1.5 ml-1">Password</label>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Enter your password"
                                        required
                                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-white text-sm placeholder:text-[#555] focus:outline-none focus:border-[#00FF87] transition-colors"
                                    />
                                </div>
                                {authMode === "signup" && (
                                    <div>
                                        <label className="block text-white text-xs font-semibold mb-1.5 ml-1">Confirm Password</label>
                                        <input
                                            type="password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="Confirm your password"
                                            required
                                            className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-white text-sm placeholder:text-[#555] focus:outline-none focus:border-[#00FF87] transition-colors"
                                        />
                                    </div>
                                )}
                                {authMode === "login" && (
                                    <div className="text-right">
                                        <button 
                                            type="button"
                                            className="text-[#00FF87] text-xs font-semibold bg-transparent border-none cursor-pointer hover:underline"
                                        >
                                            Forgot password?
                                        </button>
                                    </div>
                                )}
                            </div>

                            <button 
                                type="submit"
                                disabled={isLoading}
                                className="w-full py-3 bg-[#00FF87] text-black font-bold rounded-lg hover:opacity-90 transition-opacity cursor-pointer text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-black"></div>
                                        {authMode === "login" ? "Signing In..." : "Creating Account..."}
                                    </span>
                                ) : (
                                    authMode === "login" ? "Sign In" : "Sign Up"
                                )}
                            </button>

                            <div className="flex items-center gap-3 text-[#A0A0A0] text-xs font-semibold">
                                <div className="flex-1 h-[1px] bg-white/10" />
                                OR
                                <div className="flex-1 h-[1px] bg-white/10" />
                            </div>

                            <button
                                type="button"
                                onClick={() => setActiveTab("wallet")}
                                className="w-full flex items-center justify-center gap-2 p-2.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all cursor-pointer group"
                            >
                                <div className="w-6 h-6 bg-[#00FF87] rounded-lg flex items-center justify-center text-xs">
                                    <Image src="/chain.png" alt="Wallet" width={14} height={14} />
                                </div>
                                <span className="text-white text-xs font-semibold">Connect with Wallet Instead</span>
                            </button>

                            <div className="text-center">
                                <p className="text-[#A0A0A0] text-xs">
                                    {authMode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            setAuthMode(authMode === "login" ? "signup" : "login");
                                            setError("");
                                        }}
                                        className="text-[#00FF87] font-semibold bg-transparent border-none cursor-pointer hover:underline"
                                    >
                                        {authMode === "login" ? "Sign up" : "Sign in"}
                                    </button>
                                </p>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
