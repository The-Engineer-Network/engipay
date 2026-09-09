import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { WalletProvider } from "@/contexts/WalletContext";
import { ChipiPayProviderWrapper } from "@/contexts/ChipiPayContext";
import { Toaster } from "@/components/ui/toaster";
import { UserOnboarding } from "@/components/onboarding/UserOnboarding";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "EngiPay - Crypto Payments & Swaps",
  description:
    "Send crypto, swap across chains, and track your portfolio in one wallet-native app.",
  generator: "EngiPay",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta
          httpEquiv="Cache-Control"
          content="no-cache, no-store, must-revalidate"
        />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
      </head>
      <body className="font-sans" suppressHydrationWarning>
        <Suspense fallback={
          <div className="min-h-screen bg-black flex items-center justify-center">
            <div className="text-green-400 text-xl">Loading EngiPay...</div>
          </div>
        }>
          <WalletProvider>
            <ChipiPayProviderWrapper>
              {children}
              <UserOnboarding />
              <Toaster />
              <Analytics />
            </ChipiPayProviderWrapper>
          </WalletProvider>
        </Suspense>
      </body>
    </html>
  );
}
