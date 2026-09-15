import type { Metadata } from "next"
import Link from "next/link"
import { Users, Target, Rocket } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHero } from "@/components/marketing/MarketingHero"

export const metadata: Metadata = {
  title: "About - EngiPay",
  description:
    "EngiPay is a Nigerian crypto payments app: send and receive, pay by code, and move money between crypto and Naira.",
}

const VALUES = [
  {
    icon: Users,
    title: "Built for real users",
    body: "Most people do not want to think about gas, chains or seed phrases. They want the money to arrive. Every screen is judged on that.",
  },
  {
    icon: Target,
    title: "Honest about what works",
    body: "A feature that is not finished says so. We would rather show an empty state than a number we made up.",
  },
  {
    icon: Rocket,
    title: "Naira first",
    body: "Crypto is only useful here if it reaches a Nigerian bank account. The Naira side is a core feature, not an afterthought.",
  },
]

export default function AboutPage() {
  return (
    <>
      <MarketingHero
        title="About"
        highlight="EngiPay"
        description="A payments app that connects crypto and the Naira, so money can move in and out of Nigeria without a maze of steps."
      />

      <section className="py-16">
        <div className="container max-w-3xl">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">Why we are building it</h2>
          <p className="mb-4 leading-relaxed text-muted-foreground">
            Sending money across borders from Nigeria is slow and expensive, and holding value in
            a currency that moves against you is worse. Crypto solves part of that, but only if
            you can get in and out of Naira easily, and pay someone without copying a long
            address between apps.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            EngiPay does four things: buy and sell crypto for Naira, pay and get paid by scanning
            a code, send Bitcoin wallet to wallet, and hold and convert what you own in one
            place. Nothing else, until those four are genuinely good.
          </p>
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="container grid max-w-5xl gap-5 md:grid-cols-3">
          {VALUES.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <CardContent className="p-6">
                <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mb-2 text-base font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="container text-center">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">Where we are</h2>
          <p className="mx-auto mb-8 max-w-xl leading-relaxed text-muted-foreground">
            EngiPay is in active development. Wallet connection, balances, sending on Base and
            payment codes work today. Naira conversion, Bitcoin sending and history are being
            built.
          </p>
          <Link
            href="/features"
            className="inline-block rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            See what is ready
          </Link>
        </div>
      </section>
    </>
  )
}
