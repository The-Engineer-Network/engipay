"use client";
import { useState, useEffect } from "react";
import Image from "next/image";

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
    const [activeTab, setActiveTab] = useState<"wallet" | "email">("wallet");

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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-[480px] bg-[#1A1A1A] border border-[#00BF6333] rounded-[30px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">

                {/* Header */}
                <div className="pt-8 lg:pt-10 pb-4 lg:pb-6 px-6 lg:px-10 text-center relative">
                    <button
                        onClick={onClose}
                        className="absolute top-4 lg:top-6 right-4 lg:right-8 text-white/40 hover:text-white transition-colors bg-transparent border-none cursor-pointer p-2 z-10"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>

                    <h2 className="text-2xl lg:text-3xl font-bold text-white mb-2">Welcome to EngiPay</h2>
                    <p className="text-[#A0A0A0] text-xs lg:text-sm">
                        {activeTab === "wallet" ? "Choose your preferred sign in method" : "Sign in to your account"}
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex border-y border-white/10">
                    <button
                        className={`flex-1 py-3 lg:py-4 text-xs lg:text-sm font-semibold transition-all relative bg-transparent border-none cursor-pointer ${activeTab === "wallet" ? "text-[#00FF87]" : "text-[#A0A0A0]"
                            }`}
                        onClick={() => setActiveTab("wallet")}
                    >
                        Wallet Connect
                        {activeTab === "wallet" && (
                            <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#00FF87]" />
                        )}
                    </button>
                    <button
                        className={`flex-1 py-3 lg:py-4 text-xs lg:text-sm font-semibold transition-all relative bg-transparent border-none cursor-pointer ${activeTab === "email" ? "text-[#00FF87]" : "text-[#A0A0A0]"
                            }`}
                        onClick={() => setActiveTab("email")}
                    >
                        Email & Password
                        {activeTab === "email" && (
                            <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#00FF87]" />
                        )}
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 lg:p-8">
                    {activeTab === "wallet" ? (
                        <div className="space-y-3 lg:space-y-4">
                            {/* Wallet Buttons */}
                            <button className="w-full flex items-center justify-between p-3 lg:p-4 bg-white/5 border border-white/10 rounded-xl lg:rounded-2xl hover:bg-white/10 transition-all group cursor-pointer text-left">
                                <div className="flex items-center gap-3 lg:gap-4">
                                    <div className="w-8 h-8 lg:w-10 lg:h-10 bg-[#00FF87] rounded-lg flex items-center justify-center">
                                        <span className="text-xs">🦊</span>
                                    </div>
                                    <span className="text-white text-sm lg:text-base font-semibold">MetaMask</span>
                                </div>
                            </button>

                            <button className="w-full flex items-center justify-between p-3 lg:p-4 bg-white/5 border border-white/10 rounded-xl lg:rounded-2xl hover:bg-white/10 transition-all group cursor-pointer text-left">
                                <div className="flex items-center gap-3 lg:gap-4">
                                    <div className="w-8 h-8 lg:w-10 lg:h-10 bg-[#00FF87] rounded-lg flex items-center justify-center">
                                        <span className="text-white font-bold">🛡️</span>
                                    </div>
                                    <span className="text-white text-sm lg:text-base font-semibold">Argent Wallet</span>
                                </div>
                            </button>

                            <button className="w-full flex items-center justify-between p-3 lg:p-4 bg-white/5 border border-white/10 rounded-xl lg:rounded-2xl hover:bg-white/10 transition-all group cursor-pointer text-left">
                                <div className="flex items-center gap-3 lg:gap-4">
                                    <div className="w-8 h-8 lg:w-10 lg:h-10 bg-[#00FF87] rounded-lg flex items-center justify-center">
                                        <span className="text-white font-bold">⚡</span>
                                    </div>
                                    <span className="text-white text-sm lg:text-base font-semibold">Braavos Wallet</span>
                                </div>
                            </button>

                            {/* <button className="w-full flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all group cursor-pointer">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-[#00FF87] rounded-lg flex items-center justify-center">
                                        <span className="text-white font-bold">W</span>
                                    </div>
                                    <span className="text-white font-semibold">WalletConnect</span>
                                </div>
                            </button> */}

                            {/* Footer text */}
                            <div className="pt-2 lg:pt-4 text-center">
                                <p className="text-[#A0A0A0] text-xs lg:text-sm">
                                    Don't have a wallet?{" "}
                                    <button className="text-[#00FF87] font-semibold bg-transparent border-none cursor-pointer hover:underline">
                                        Sign up with email
                                    </button>
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-5 lg:space-y-6">
                            <div className="space-y-3 lg:space-y-4 text-left">
                                <div>
                                    <label className="block text-white text-xs lg:text-sm font-semibold mb-1.5 lg:mb-2 ml-1">Email Address</label>
                                    <input
                                        type="email"
                                        placeholder="your@email.com"
                                        className="w-full bg-white/5 border border-white/10 rounded-lg lg:rounded-xl p-3 lg:p-4 text-white text-sm lg:text-base placeholder:text-[#555] focus:outline-none focus:border-[#00FF87] transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-white text-xs lg:text-sm font-semibold mb-1.5 lg:mb-2 ml-1">Password</label>
                                    <input
                                        type="password"
                                        placeholder="Enter your password"
                                        className="w-full bg-white/5 border border-white/10 rounded-lg lg:rounded-xl p-3 lg:p-4 text-white text-sm lg:text-base placeholder:text-[#555] focus:outline-none focus:border-[#00FF87] transition-colors"
                                    />
                                </div>
                                <div className="text-right">
                                    <button className="text-[#00FF87] text-xs lg:text-sm font-semibold bg-transparent border-none cursor-pointer hover:underline">
                                        Forgot password?
                                    </button>
                                </div>
                            </div>

                            <button className="w-full py-3 lg:py-4 bg-[#00FF87] text-black font-bold rounded-lg lg:rounded-xl hover:opacity-90 transition-opacity cursor-pointer text-base lg:text-lg">
                                Sign In
                            </button>

                            <div className="flex items-center gap-3 lg:gap-4 text-[#A0A0A0] text-[10px] lg:text-xs font-semibold">
                                <div className="flex-1 h-[1px] bg-white/10" />
                                OR
                                <div className="flex-1 h-[1px] bg-white/10" />
                            </div>

                            <button
                                onClick={() => setActiveTab("wallet")}
                                className="w-full flex items-center justify-center gap-2 lg:gap-3 p-3 lg:p-4 bg-white/5 border border-white/10 rounded-lg lg:rounded-xl hover:bg-white/10 transition-all cursor-pointer group"
                            >
                                <div className="w-6 h-6 lg:w-8 lg:h-8 bg-[#00FF87] rounded-lg flex items-center justify-center text-xs">
                                    <Image src="/chain.png" alt="Wallet" width={16} height={16} className="lg:w-5 lg:h-5" />
                                </div>
                                <span className="text-white text-xs lg:text-sm font-semibold">Connect with Wallet Instead</span>
                            </button>

                            <div className="text-center">
                                <p className="text-[#A0A0A0] text-xs lg:text-sm">
                                    Don't have an account?{" "}
                                    <button className="text-[#00FF87] font-semibold bg-transparent border-none cursor-pointer hover:underline">
                                        Sign up
                                    </button>
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
