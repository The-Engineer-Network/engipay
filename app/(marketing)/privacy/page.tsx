import type { Metadata } from "next"
import { Card, CardContent } from "@/components/ui/card"
import { Eye, Lock, UserCheck, Share2 } from "lucide-react"
import { MarketingHero } from "@/components/marketing/MarketingHero"

export const metadata: Metadata = {
  title: "Privacy - EngiPay",
  description: "What EngiPay collects, why, who it is shared with, and the choices you have.",
}

const LAST_UPDATED = "12 September 2026"

const PRINCIPLES = [
  {
    icon: Eye,
    title: "We collect little",
    body: "Only what a payments app needs to work and to meet the law. No selling of your data, ever.",
  },
  {
    icon: Lock,
    title: "We never hold your seed phrase",
    body: "EngiPay does not ask for it and cannot use it. Anyone who asks you for it is not us.",
  },
  {
    icon: UserCheck,
    title: "You can ask for your data",
    body: "See it, correct it, or have it deleted, except where the law requires us to keep records.",
  },
  {
    icon: Share2,
    title: "Sharing is limited",
    body: "Only with the partners who complete your payment or identity check, and only when the law requires it.",
  },
]

interface Section {
  heading: string
  paragraphs?: string[]
  items?: { label?: string; text: string }[]
}

const SECTIONS: Section[] = [
  {
    heading: "What we collect",
    items: [
      {
        label: "Wallet address",
        text: "The public address you connect, so we can show your balances and process transfers. Never your private keys or seed phrase.",
      },
      {
        label: "Transaction details",
        text: "Amounts, assets and transaction references, so your history is accurate and so we can meet financial record-keeping rules.",
      },
      {
        label: "Identity information",
        text: "For buying or selling Naira only: your name, date of birth, an identity document and your bank account details. Nigerian law requires this before money can move between crypto and a bank account.",
      },
      {
        label: "Usage and device information",
        text: "Basic analytics such as pages visited, plus browser and device type, used to find faults and improve the app.",
      },
    ],
  },
  {
    heading: "Why we use it",
    items: [
      { label: "To run the service", text: "Showing balances, moving funds, and completing Naira transfers." },
      { label: "To keep accounts safe", text: "Spotting fraud, abuse and suspicious activity." },
      { label: "To meet the law", text: "Identity checks, record keeping and reporting obligations in Nigeria." },
      { label: "To improve the app", text: "Understanding which parts are used and where people get stuck." },
    ],
  },
  {
    heading: "Who we share it with",
    paragraphs: [
      "We do not sell, rent or trade your personal information. We share it only in these cases:",
    ],
    items: [
      {
        text: "The licensed partner that completes a Naira payment or payout, and the provider that runs the identity check.",
      },
      { text: "Service providers who help us operate, under confidentiality agreements." },
      { text: "Authorities, when the law requires it." },
      { text: "Anyone else only with your explicit consent." },
    ],
  },
  {
    heading: "How your information is protected",
    paragraphs: [
      "These are the measures actually in place. We will update this list as the service grows rather than claim protections we have not built.",
    ],
    items: [
      { text: "All traffic between your device and EngiPay is encrypted in transit (HTTPS)." },
      { text: "Any signing key sits in a separate, isolated service, never in the app or the main API." },
      { text: "Access to production data is limited to the people who need it, and is logged." },
      { text: "Large withdrawals require a second approval before they are released." },
    ],
  },
  {
    heading: "Your rights",
    paragraphs: ["You can ask us to:"],
    items: [
      { label: "Access", text: "Give you a copy of the personal data we hold about you." },
      { label: "Correct", text: "Fix anything inaccurate." },
      { label: "Delete", text: "Remove your data, except records the law obliges us to keep." },
      { label: "Port", text: "Provide your data in a portable format." },
      { label: "Opt out", text: "Stop non-essential data collection, such as analytics." },
    ],
  },
  {
    heading: "How long we keep it",
    paragraphs: [
      "Account and transaction records are kept for as long as the law requires for financial services in Nigeria, which is longer than your use of the app. Analytics data is kept for a short period and is not tied to your identity.",
    ],
  },
]

export default function PrivacyPage() {
  return (
    <>
      <MarketingHero
        title="Privacy"
        description="What we collect, why we collect it, and what you can ask us to do with it."
        meta={`Last updated ${LAST_UPDATED}`}
      />

      <section className="py-16">
        <div className="container grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <CardContent className="p-5">
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <h2 className="mb-1.5 text-sm font-semibold">{title}</h2>
                <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="container max-w-3xl space-y-12">
          {SECTIONS.map((section) => (
            <div key={section.heading}>
              <h2 className="mb-4 text-xl font-semibold tracking-tight">{section.heading}</h2>

              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mb-4 leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}

              {section.items && (
                <ul className="space-y-3">
                  {section.items.map((item) => (
                    <li key={item.text} className="border-l-2 border-border pl-4 text-sm leading-relaxed">
                      {item.label && <span className="font-medium">{item.label}: </span>}
                      <span className="text-muted-foreground">{item.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <div>
            <h2 className="mb-4 text-xl font-semibold tracking-tight">Contact us</h2>
            <p className="mb-4 leading-relaxed text-muted-foreground">
              For any question about this policy, or to exercise the rights above, email{" "}
              <a href="mailto:privacy@engipay.com" className="text-primary hover:underline">
                privacy@engipay.com
              </a>
              .
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This policy will be updated as the Naira features go live and the registered company
              details are confirmed. We will say clearly when anything material changes.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
