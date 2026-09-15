import type { Metadata } from "next"
import Link from "next/link"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { MarketingHero } from "@/components/marketing/MarketingHero"

export const metadata: Metadata = {
  title: "FAQ - EngiPay",
  description: "Common questions about EngiPay: what it does, fees, security, and Naira transfers.",
}

interface QaGroup {
  heading: string
  items: { question: string; answer: string }[]
}

const GROUPS: QaGroup[] = [
  {
    heading: "The basics",
    items: [
      {
        question: "What is EngiPay?",
        answer:
          "A crypto payments app for Nigeria. You can send and receive crypto, pay by scanning a code, send Bitcoin wallet to wallet, convert one token into another, and move money between crypto and Naira.",
      },
      {
        question: "Which networks does it use?",
        answer:
          "Base, an Ethereum layer 2, for USDC and ETH, because transfers there settle in seconds and cost very little. Bitcoin runs on the Bitcoin network itself, not as a wrapped token.",
      },
      {
        question: "What wallets can I use?",
        answer:
          "Any of them. Browser wallets such as MetaMask, Rainbow, Coinbase Wallet and Rabby are detected automatically, and mobile wallets connect by scanning a WalletConnect code.",
      },
      {
        question: "How do I get started?",
        answer:
          "Connect your wallet and you can send and receive straight away. Buying or selling Naira needs a one-time identity check first, because the law requires it.",
      },
    ],
  },
  {
    heading: "Moving money",
    items: [
      {
        question: "How do I convert crypto to Naira?",
        answer:
          "Pick the asset and the amount, check the quote, and confirm. The Naira goes to your verified Nigerian bank account. Buying works the same way in reverse, starting from a Naira amount.",
      },
      {
        question: "What does it cost?",
        answer:
          "Payments between EngiPay users are free. Sending on-chain pays the usual network fee. Conversions and Naira transfers show the rate and the fee together, before you confirm anything.",
      },
      {
        question: "How does paying by code work?",
        answer:
          "The person getting paid shows a code, optionally with an amount already in it. The payer scans it and confirms. The codes use the same standards other wallets read, so they work outside EngiPay too.",
      },
      {
        question: "Which features are live today?",
        answer:
          "Connecting a wallet, seeing your balances, sending ETH and USDC on Base, and reading and creating payment codes. Naira conversion, token swaps, Bitcoin sending and full history are still being built, and the app says so on each screen rather than pretending otherwise.",
      },
    ],
  },
  {
    heading: "Security and availability",
    items: [
      {
        question: "Is EngiPay secure?",
        answer:
          "We never ask for your seed phrase, and every transaction is shown in full before you confirm it. Signing keys are kept in a separate service from the app, large withdrawals need a second approval, and balances are checked against the chain on a schedule.",
      },
      {
        question: "Where is EngiPay available?",
        answer:
          "The crypto features work anywhere you can reach the internet. Buying and selling Naira is for Nigeria, since it settles into Nigerian bank accounts and follows Nigerian identity rules.",
      },
      {
        question: "What happens if I lose my phone?",
        answer:
          "Anything held in your own connected wallet is recovered the way that wallet normally recovers, with its seed phrase. Funds held in an EngiPay balance are tied to your account, so you regain access by signing in again.",
      },
    ],
  },
]

export default function FaqPage() {
  return (
    <>
      <MarketingHero
        title="Frequently asked"
        highlight="questions"
        description="What EngiPay does, what it costs, and how your money is handled."
      />

      <section className="py-16">
        <div className="container max-w-3xl space-y-12">
          {GROUPS.map((group) => (
            <div key={group.heading}>
              <h2 className="mb-4 text-lg font-semibold tracking-tight">{group.heading}</h2>
              <Accordion type="single" collapsible className="w-full">
                {group.items.map((item) => (
                  <AccordionItem key={item.question} value={item.question}>
                    <AccordionTrigger className="text-left">{item.question}</AccordionTrigger>
                    <AccordionContent className="leading-relaxed text-muted-foreground">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="container text-center">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">Still stuck?</h2>
          <p className="mx-auto mb-8 max-w-xl text-muted-foreground">
            The help centre has step-by-step guides for each part of the app.
          </p>
          <Link
            href="/help"
            className="inline-block rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go to the help centre
          </Link>
        </div>
      </section>
    </>
  )
}
