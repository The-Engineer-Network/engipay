import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftRight, QrCode, Bitcoin, Wallet, Check, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHero } from "@/components/marketing/MarketingHero"

export const metadata: Metadata = {
  title: "Features - EngiPay",
  description:
    "Send and receive crypto, pay by scanning a code, send Bitcoin, and move money between crypto and Naira.",
}

interface Feature {
  icon: typeof Wallet
  title: string
  summary: string
  detail: string
  /** What a user can do today, with no backend connected. */
  live: string[]
  /** What is designed and waiting on a service. */
  pending: string[]
}

const FEATURES: Feature[] = [
  {
    icon: ArrowLeftRight,
    title: "Naira in and out",
    summary: "Buy crypto with Naira, and cash out to your bank account.",
    detail:
      "Enter an amount, see the rate and the fee before you agree to anything, and confirm. Buying takes a bank transfer or card payment and puts crypto in your account. Selling sends Naira to your own Nigerian bank account.",
    live: ["The buy and sell screens, with quote breakdowns"],
    pending: ["A licensed Naira partner", "A one-time identity check", "Bank account payouts"],
  },
  {
    icon: QrCode,
    title: "Scan to pay and receive",
    summary: "Show a code to get paid. Scan a code to pay.",
    detail:
      "Your code can carry an amount and an asset, so the person paying does not have to type anything. The codes follow the same standards other wallets use, so they work outside EngiPay too.",
    live: [
      "A working camera scanner",
      "Your receive code, with an optional amount",
      "Reading codes from other wallets",
    ],
    pending: ["Instant EngiPay to EngiPay transfers, with no network fee"],
  },
  {
    icon: Bitcoin,
    title: "Bitcoin, wallet to wallet",
    summary: "Send and receive real Bitcoin.",
    detail:
      "Bitcoin on the Bitcoin network, not a wrapped token standing in for it. Send to any Bitcoin address, and receive from any wallet or exchange.",
    live: ["Reading Bitcoin payment codes"],
    pending: ["Bitcoin wallets and sending, which need the chain service"],
  },
  {
    icon: Wallet,
    title: "Add a wallet, then send or convert",
    summary: "Bring your own wallet, and move money from inside EngiPay.",
    detail:
      "Connect the wallet you already use and move funds into EngiPay. From there, send to any address, or convert one token into another. Withdraw back to your own wallet whenever you want.",
    live: ["Wallet connection", "Sending ETH and USDC on Base", "Live balances"],
    pending: ["Deposits into an EngiPay balance", "Converting one token into another"],
  },
]

export default function FeaturesPage() {
  return (
    <>
      <MarketingHero
        title="Features"
        description="Four things, done properly: Naira in and out, scan to pay, Bitcoin transfers, and one place to hold and convert what you own."
      />

      <section className="py-16">
        <div className="container grid max-w-5xl gap-6 md:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, summary, detail, live, pending }) => (
            <Card key={title} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-4 p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>

                <div>
                  <h2 className="text-lg font-semibold">{title}</h2>
                  <p className="mt-1 text-sm font-medium text-muted-foreground">{summary}</p>
                </div>

                <p className="text-sm leading-relaxed text-muted-foreground">{detail}</p>

                <dl className="mt-auto space-y-3 border-t border-border pt-4 text-sm">
                  <div>
                    <dt className="mb-1.5 flex items-center gap-1.5 font-medium text-success">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Working now
                    </dt>
                    <dd>
                      <ul className="space-y-1 text-muted-foreground">
                        {live.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      In build
                    </dt>
                    <dd>
                      <ul className="space-y-1 text-muted-foreground">
                        {pending.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="container text-center">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">Try what is ready</h2>
          <p className="mx-auto mb-8 max-w-xl text-muted-foreground">
            Connect a wallet and send on Base today. The rest arrives as each service is
            connected.
          </p>
          <Link
            href="/dashboard"
            className="inline-block rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open the app
          </Link>
        </div>
      </section>
    </>
  )
}
