import type { Metadata } from "next"
import Link from "next/link"
import { Wallet, ArrowUpRight, QrCode, Banknote, LifeBuoy } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHero } from "@/components/marketing/MarketingHero"

export const metadata: Metadata = {
  title: "Help centre - EngiPay",
  description: "Step-by-step guides for connecting a wallet, sending, getting paid and Naira transfers.",
}

interface Guide {
  id: string
  icon: typeof Wallet
  title: string
  intro: string
  steps: string[]
  note?: string
}

const GUIDES: Guide[] = [
  {
    id: "connect",
    icon: Wallet,
    title: "Connect your wallet",
    intro: "Everything starts here. EngiPay works with the wallet you already use.",
    steps: [
      "Open the app and press Connect wallet.",
      "Pick your wallet from the list. Browser wallets appear automatically.",
      "On a phone, choose WalletConnect and scan the code with your wallet app.",
      "Approve the connection request in your wallet.",
    ],
    note: "Connecting only shares your address. It never gives EngiPay permission to move your funds.",
  },
  {
    id: "send",
    icon: ArrowUpRight,
    title: "Send crypto",
    intro: "Send ETH or USDC on Base to any wallet address.",
    steps: [
      "Go to Send from the home screen.",
      "Paste the address, or scan a code to fill it in for you.",
      "Choose the asset and type the amount.",
      "Press Send and approve the transaction in your wallet.",
      "Wait for the confirmation, then open the link to view it on the block explorer.",
    ],
    note: "Check the first and last characters of the address before sending. On-chain transfers cannot be reversed.",
  },
  {
    id: "receive",
    icon: QrCode,
    title: "Get paid with a code",
    intro: "Show a code instead of reading out a long address.",
    steps: [
      "Go to Receive.",
      "Leave the amount blank for an open request, or type one to ask for a specific sum.",
      "Choose the asset you want to be paid in.",
      "Show the code, or press Share to send the link on WhatsApp.",
    ],
    note: "The code uses a standard format, so it also works in wallets that are not EngiPay.",
  },
  {
    id: "scan",
    icon: QrCode,
    title: "Scan to pay",
    intro: "Pay someone by reading their code.",
    steps: [
      "Go to Scan and press Start camera.",
      "Allow camera access when the browser asks.",
      "Point at the code. It reads automatically, with no button to press.",
      "Check the address and amount, then confirm the payment.",
    ],
    note: "If the camera will not start, paste the code or address into the box underneath instead.",
  },
  {
    id: "naira",
    icon: Banknote,
    title: "Buy and sell Naira",
    intro: "Move between Naira and crypto, settled to a Nigerian bank account.",
    steps: [
      "Go to Buy to fund with Naira, or Sell to cash out.",
      "Enter the amount and read the quote: the rate and the fee are shown separately.",
      "Complete the identity check the first time. It is a legal requirement, not an EngiPay rule.",
      "Confirm before the quote expires. Quotes are only held for a short time because the rate moves.",
    ],
    note: "These screens are built, but they cannot take a payment until the Naira partner is connected.",
  },
]

const TROUBLE = [
  {
    problem: "The camera will not start when I scan",
    fix: "The browser blocked it. Allow camera access for the site in your browser settings, then reload. You can always paste a code or address by hand instead.",
  },
  {
    problem: "My transaction is stuck as pending",
    fix: "It is waiting to be included on-chain. Open the block explorer link to follow it. On Base this normally takes seconds, and network congestion is the usual cause of a delay.",
  },
  {
    problem: "The send button does nothing",
    fix: "Check that the address is valid, the amount is above zero, and you have enough ETH left for the network fee. Sending your entire ETH balance leaves nothing to pay that fee.",
  },
  {
    problem: "My balance shows zero but I have funds",
    fix: "Check that your wallet is on the right network. EngiPay uses Base, so funds on Ethereum mainnet or another chain will not show here.",
  },
]

export default function HelpPage() {
  return (
    <>
      <MarketingHero
        title="Help"
        highlight="centre"
        description="Short guides for each part of the app, and fixes for the things that usually go wrong."
      />

      <section className="py-16">
        <div className="container max-w-3xl">
          <nav aria-label="Guides" className="mb-12 flex flex-wrap gap-2">
            {GUIDES.map((guide) => (
              <a
                key={guide.id}
                href={`#${guide.id}`}
                className="rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {guide.title}
              </a>
            ))}
          </nav>

          <div className="space-y-6">
            {GUIDES.map(({ id, icon: Icon, title, intro, steps, note }) => (
              <Card key={id} id={id} className="scroll-mt-24">
                <CardContent className="p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h2 className="text-lg font-semibold">{title}</h2>
                  </div>

                  <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{intro}</p>

                  <ol className="mb-4 space-y-2.5">
                    {steps.map((step, index) => (
                      <li key={step} className="flex gap-3 text-sm">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {index + 1}
                        </span>
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>

                  {note && (
                    <p className="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                      {note}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="container max-w-3xl">
          <div className="mb-8 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LifeBuoy className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="text-2xl font-semibold tracking-tight">When something goes wrong</h2>
          </div>

          <dl className="space-y-5">
            {TROUBLE.map(({ problem, fix }) => (
              <div key={problem} className="border-l-2 border-border pl-4">
                <dt className="mb-1.5 font-medium">{problem}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{fix}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-10 text-sm text-muted-foreground">
            Still stuck? The{" "}
            <Link href="/faq" className="text-primary hover:underline">
              FAQ
            </Link>{" "}
            covers fees, security and where EngiPay is available.
          </p>
        </div>
      </section>
    </>
  )
}
