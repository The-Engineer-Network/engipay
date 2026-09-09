"use client";
import Image from "next/image";
import { useState } from "react";

interface NavbarProps {
  onGetStarted?: () => void;
}

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
];

export default function Navbar({ onGetStarted }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="fixed left-0 top-0 z-[1000] w-full border-b border-border bg-background/80 py-4 backdrop-blur-md">
      <div className="container flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-xl font-bold">
          <Image src="/logo.svg" alt="" width={32} height={32} aria-hidden="true" />
          EngiPay
        </div>

        <div className="hidden gap-10 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              /* was `text-muted`, a background token, so these were unreadable */
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <button
          onClick={onGetStarted}
          className="hidden rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 lg:block"
        >
          Get started
        </button>

        <button
          className="text-foreground lg:hidden"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label={isOpen ? "Close menu" : "Open menu"}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {isOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 12h18M3 6h18M3 18h18" />}
          </svg>
        </button>

        {isOpen && (
          <div className="absolute left-0 top-full flex w-full flex-col gap-4 border-b border-border bg-background p-5 shadow-2xl lg:hidden">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <button
              onClick={() => {
                setIsOpen(false);
                onGetStarted?.();
              }}
              className="mt-2 w-full rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Get started
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
