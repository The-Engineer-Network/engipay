import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/components/theme-provider";
import { Web3Provider } from "@/contexts/Web3Provider";
import { WalletProvider } from "@/contexts/WalletContext";
import { StellarWalletProvider } from "@/contexts/StellarWalletContext";
import { Toaster } from "@/components/ui/toaster";
import { UserOnboarding } from "@/components/onboarding/UserOnboarding";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "EngiPay - Crypto Payments",
  description:
    "Send and receive crypto on Base, Stellar and Bitcoin, pay by QR code, and convert between crypto and Naira.",
  generator: "EngiPay",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Web3Provider>
            <StellarWalletProvider>
              <WalletProvider>
                {children}
                <UserOnboarding />
                <ThemeToggle />
                <Toaster />
                <Analytics />
              </WalletProvider>
            </StellarWalletProvider>
          </Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
