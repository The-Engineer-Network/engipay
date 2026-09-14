import type { Metadata } from "next"
import { Layers, Bitcoin, QrCode, Wallet, ShieldCheck, Server } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHero } from "@/components/marketing/MarketingHero"

export const metadata: Metadata = {
  title: "Technology - EngiPay",
  description:
    "What EngiPay is built on: Base, the Bitcoin network, standard payment codes, and a Rust service for keys and transfers.",
}

const STACK = [
  {
    icon: Layers,
    title: "Base, an Ethereum layer 2",
    body: "Transfers settle in seconds and cost a fraction of a cent, which is what makes small everyday payments sensible. USDC and ETH live here.",
  },
  {
    icon: Bitcoin,
    title: "The Bitcoin network",
    body: "Bitcoin support means real Bitcoin, not a wrapped token standing in for it. That needs its own wallet handling, fee estimation and confirmation rules.",
  },
  {
    icon: QrCode,
    title: "Standard payment codes",
    body: "Our codes follow EIP-681 on Base and BIP-21 on Bitcoin, the formats other wallets already read. EngiPay adds a note and a reference on top, without breaking that compatibility.",
  },
  {
    icon: Wallet,
    title: "Any wallet you already use",
    body: "Browser wallets are discovered automatically through EIP-6963, so there is no hardcoded list to fall behind. Mobile wallets connect over WalletConnect.",
  },
  {
    icon: Server,
    title: "Rust where the money is",
    body: "Keys, signing and transaction tracking belong in a service written in Rust, separate from the rest of the app. The product API around it is TypeScript, where the integration work is.",
  },
  {
    icon: ShieldCheck,
    title: "Security by separation",
    body: "Signing keys never touch the app or the product API. Large withdrawals need a second approval, partner callbacks are signature-checked, and balances are reconciled against the chain on a schedule.",
  },
]

export default function TechnologyPage() {
  return (
    <>
      <MarketingHero
        title="Technology"
        description="The pieces EngiPay is built from, and why each one was chosen."
      />

      <section className="py-16">
        <div className="container grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STACK.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <CardContent className="p-6">
                <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 className="mb-2 text-base font-semibold">{title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="container max-w-3xl">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">Where the build is</h2>
          <p className="mb-4 leading-relaxed text-muted-foreground">
            The app you can open today connects your wallet, reads your balances on Base, sends
            ETH and USDC, and reads and writes payment codes. That part is real and runs without
            any server of ours.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Naira conversion, token swaps, Bitcoin sending and transaction history need services
            that are still being built. Those screens exist, and each one says plainly which
            service it is waiting for rather than showing numbers that are not real.
          </p>
        </div>
      </section>
    </>
  )
}
