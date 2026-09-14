import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/components/theme-provider";
import { Web3Provider } from "@/contexts/Web3Provider";
import { WalletProvider } from "@/contexts/WalletContext";
import { Toaster } from "@/components/ui/toaster";
import { UserOnboarding } from "@/components/onboarding/UserOnboarding";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "EngiPay - Crypto Payments",
  description:
    "Send and receive crypto, pay by QR code, and convert between crypto and Naira.",
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
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Web3Provider>
            <WalletProvider>
              {children}
              <UserOnboarding />
              <ThemeToggle />
              <Toaster />
              <Analytics />
            </WalletProvider>
          </Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
