import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EngiPay",
    short_name: "EngiPay",
    description: "Send and receive crypto on Base, Stellar and Bitcoin, pay by QR code, and convert to Naira.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#050806",
    theme_color: "#050806",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
