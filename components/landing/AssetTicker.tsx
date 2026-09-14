const ITEMS = [
  { symbol: "₦", name: "Naira" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ether" },
  { symbol: "Base", name: "Layer 2" },
  { symbol: "QR", name: "Scan to pay" },
]

/**
 * A quiet ticker of what moves through the app. Duplicated once so the
 * translateX(-50%) loop in the .marquee keyframes joins seamlessly.
 */
export default function AssetTicker() {
  return (
    <section className="border-y border-border bg-card/30 py-6" aria-label="Supported assets">
      <div className="marquee-mask overflow-hidden">
        <div className="marquee gap-10 pr-10">
          {[...ITEMS, ...ITEMS].map((item, index) => (
            <div
              key={`${item.symbol}-${index}`}
              className="flex shrink-0 items-center gap-2.5"
              aria-hidden={index >= ITEMS.length}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-primary">
                {item.symbol.length > 3 ? item.symbol.slice(0, 2) : item.symbol}
              </span>
              <span className="whitespace-nowrap text-sm text-muted-foreground">{item.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
