"use client";

import { ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, type Theme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/wagmi";

import "@rainbow-me/rainbowkit/styles.css";

const base = darkTheme({
  accentColor: "#00FF7F",
  accentColorForeground: "#04140b",
  borderRadius: "large",
  overlayBlur: "small",
  fontStack: "system",
});

/**
 * RainbowKit's own dark theme is a neutral grey that reads as a different
 * product next to ours. This pulls its surfaces onto the EngiPay palette:
 * near-black with a green cast, hairline borders, and a brand-tinted glow
 * instead of a flat drop shadow.
 */
const engipayWalletTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    accentColor: "#00FF7F",
    accentColorForeground: "#04140b",
    modalBackground: "hsl(150 12% 6%)",
    modalBorder: "hsl(150 8% 16%)",
    modalText: "hsl(150 8% 96%)",
    modalTextSecondary: "hsl(150 5% 64%)",
    modalTextDim: "hsl(150 5% 48%)",
    menuItemBackground: "hsl(150 10% 10%)",
    profileForeground: "hsl(150 14% 8%)",
    profileAction: "hsl(150 10% 12%)",
    profileActionHover: "hsl(150 10% 16%)",
    generalBorder: "hsl(150 8% 16%)",
    generalBorderDim: "hsl(150 8% 12%)",
    actionButtonBorder: "hsl(150 8% 18%)",
    actionButtonBorderMobile: "hsl(150 8% 18%)",
    actionButtonSecondaryBackground: "hsl(150 10% 12%)",
    closeButton: "hsl(150 5% 64%)",
    closeButtonBackground: "hsl(150 10% 12%)",
    connectButtonBackground: "hsl(150 12% 6%)",
    connectButtonInnerBackground: "hsl(150 10% 10%)",
    connectButtonText: "hsl(150 8% 96%)",
    selectedOptionBorder: "hsl(150 100% 50% / 0.5)",
    standby: "hsl(38 92% 50%)",
  },
  radii: {
    ...base.radii,
    modal: "20px",
    modalMobile: "24px",
    menuButton: "12px",
    actionButton: "12px",
    connectButton: "9999px",
  },
  shadows: {
    ...base.shadows,
    dialog: "0 28px 70px -28px hsl(150 100% 50% / 0.28), 0 0 0 1px hsl(150 8% 16%)",
    selectedWallet: "0 0 0 1px hsl(150 100% 50% / 0.45)",
    selectedOption: "0 0 0 1px hsl(150 100% 50% / 0.45)",
    profileDetailsAction: "0 2px 6px hsl(150 40% 3% / 0.4)",
    walletLogo: "0 4px 12px hsl(150 40% 3% / 0.5)",
  },
};

export function Web3Provider({ children }: { children: ReactNode }) {
  // Created in state so the client is stable across re-renders but never
  // shared between requests during SSR.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={engipayWalletTheme}
          // "compact" drops RainbowKit's illustrated "What is a Wallet?" panel,
          // which is the cartoon half of the dialog.
          modalSize="compact"
          appInfo={{ appName: "EngiPay" }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
