"use client";
import Image from 'next/image';
import { useState } from 'react';

interface NavbarProps {
  onGetStarted?: () => void;
}

export default function Navbar({ onGetStarted }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 w-full py-5 z-[1000] bg-[rgba(11,14,20,0.8)] backdrop-blur-md border-b border-[#00BF631A]">
      <div className="container mx-auto px-5 flex justify-between items-center">
        <div className="flex items-center gap-2.5 font-bold text-xl text-foreground bg-transparent">
          <Image src="/logo.svg" alt="Logo" width={32} height={32} />
          EngiPay
        </div>

        {/* Desktop Menu */}
        <div className="hidden lg:flex gap-10 text-[#A0A0A0]">
          <a href="#features" className="text-muted text-sm transition-colors hover:text-foreground">Features</a>
          <a href="#how-it-works" className="text-muted text-sm transition-colors hover:text-foreground">How it Works</a>
          <a href="#roadmap" className="text-muted text-sm transition-colors hover:text-foreground">About</a>
          <a href="#about" className="text-muted text-sm transition-colors hover:text-foreground">FAQ</a>
        </div>

        <button
          onClick={onGetStarted}
          className="hidden lg:block bg-primary text-black px-6 py-2.5 rounded-[20px] font-bold text-sm border-none cursor-pointer transition-all hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,242,138,0.4)]"
        >
          Get Started
        </button>

        {/* Mobile Menu Toggle */}
        <button
          className="lg:hidden text-white bg-transparent border-none cursor-pointer"
          onClick={() => setIsOpen(!isOpen)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 12h18M3 6h18M3 18h18" />}
          </svg>
        </button>

        {/* Mobile Dropdown */}
        {isOpen && (
          <div className="absolute top-full left-0 w-full bg-[#0b0e14] border-b border-[#00BF631A] p-5 flex flex-col gap-4 lg:hidden shadow-2xl">
            <a href="#features" className="text-[#A0A0A0] text-sm hover:text-primary" onClick={() => setIsOpen(false)}>Features</a>
            <a href="#how-it-works" className="text-[#A0A0A0] text-sm hover:text-primary" onClick={() => setIsOpen(false)}>How it Works</a>
            <a href="#roadmap" className="text-[#A0A0A0] text-sm hover:text-primary" onClick={() => setIsOpen(false)}>About</a>
            <a href="#about" className="text-[#A0A0A0] text-sm hover:text-primary" onClick={() => setIsOpen(false)}>FAQ</a>
            <button
              onClick={() => {
                setIsOpen(false);
                onGetStarted?.();
              }}
              className="bg-primary text-black px-6 py-2.5 rounded-[20px] font-bold text-sm border-none w-full mt-2"
            >
              Get Started
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
