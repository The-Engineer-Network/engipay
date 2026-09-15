import { Wallet, Banknote, QrCode, Landmark } from "lucide-react"
import { Reveal } from "@/components/marketing/Reveal"

const STEPS = [
  {
    icon: Wallet,
    title: "Connect wallet",
    desc: "Link the wallet you already use, in seconds.",
  },
  {
    icon: Banknote,
    title: "Add money",
    desc: "Buy with Naira, or receive crypto from anywhere.",
  },
  {
    icon: QrCode,
    title: "Pay or get paid",
    desc: "Send to any address, or scan a code to pay.",
  },
  {
    icon: Landmark,
    title: "Cash out",
    desc: "Convert to Naira, paid into your bank account.",
  },
]

export default function Workflow() {
  return (
    <section
      className="relative overflow-hidden border-y border-border bg-card/40 py-24"
      id="how-it-works"
    >
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-64 w-[80%] -translate-x-1/2 rounded-full bg-primary/10 blur-[100px]"
        aria-hidden="true"
      />

      <div className="container relative text-center">
        <Reveal className="mx-auto mb-16 max-w-[600px]">
          <h2 className="mb-4 text-balance text-3xl font-bold tracking-tight lg:text-4xl">
            One app. <span className="text-gradient">Four steps.</span>
          </h2>
          <p className="text-muted-foreground">
            From your bank account to anyone in the world, and back again.
          </p>
        </Reveal>

        <ol className="relative mx-auto flex max-w-[980px] flex-col items-center justify-between gap-12 md:flex-row md:items-start md:gap-4">
          {/* The rail the steps sit on. Hidden on mobile, where they stack. */}
          <span
            className="absolute left-[90px] right-[90px] top-[34px] hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block"
            aria-hidden="true"
          />

          {STEPS.map(({ icon: Icon, title, desc }, index) => (
            <Reveal
              key={title}
              as="li"
              delay={index * 120}
              className="relative z-10 flex w-full max-w-[220px] flex-col items-center"
            >
              <span className="pulse-ring mb-5 flex h-[68px] w-[68px] items-center justify-center rounded-full border border-primary/40 bg-background text-primary shadow-[0_0_30px_-10px_hsl(var(--primary)/0.8)]">
                <Icon className="h-6 w-6" aria-hidden="true" />
                <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {index + 1}
                </span>
              </span>
              <h3 className="mb-2 text-base font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
