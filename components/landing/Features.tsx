import { ArrowLeftRight, QrCode, Bitcoin, Wallet, Zap } from "lucide-react"
import { Reveal } from "@/components/marketing/Reveal"

const SMALL = [
  {
    title: "Naira in and out",
    description:
      "Buy with Naira from your bank, and cash out to it. The rate and the fee are shown before you agree to anything.",
    icon: ArrowLeftRight,
  },
  {
    title: "Real Bitcoin",
    description:
      "Send and receive BTC on the Bitcoin network itself, wallet to wallet. Not a wrapped token standing in for it.",
    icon: Bitcoin,
  },
  {
    title: "Convert in app",
    description:
      "Swap one token for another without leaving EngiPay, with a quote you can read before you confirm.",
    icon: Zap,
  },
  {
    title: "Any wallet",
    description:
      "Browser wallets are detected on their own. Mobile wallets connect by scanning a code. Nothing to install from us.",
    icon: Wallet,
  },
]

export default function Features() {
  return (
    <section className="relative overflow-hidden py-24" id="features">
      <div className="container relative">
        <Reveal className="mx-auto mb-16 max-w-[640px] text-center">
          <h2 className="mb-4 text-balance text-3xl font-bold tracking-tight lg:text-4xl">
            Everything you need,{" "}
            <span className="text-gradient">nothing you do not</span>
          </h2>
          <p className="leading-relaxed text-muted-foreground">
            Four features, built properly, instead of twenty that half work.
          </p>
        </Reveal>

        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-3">
          {/* The hero card: scan to pay, with a drawn code rather than an image. */}
          <Reveal variant="scale" className="lg:col-span-2">
            <article className="lift-card shine glass-panel group relative flex h-full flex-col justify-between gap-8 overflow-hidden p-8 sm:flex-row sm:items-center">
              <div className="relative z-10 max-w-sm">
                <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <QrCode className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mb-3 text-xl font-semibold">Scan to pay, scan to get paid</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Show a code with the amount already in it, or point your camera at someone
                  else&apos;s. The codes follow the standards other wallets read, so they work
                  outside EngiPay too.
                </p>
              </div>

              <div className="scene-3d relative z-10 shrink-0 self-center">
                <div className="tilt-3d rounded-2xl border border-border bg-background/60 p-4 shadow-2xl">
                  <div className="grid grid-cols-7 gap-1" aria-hidden="true">
                    {[
                      1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1,
                      0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1,
                    ].map((on, index) => (
                      <span
                        key={index}
                        className={`h-3 w-3 rounded-[3px] transition-colors duration-500 ${
                          on ? "bg-primary group-hover:bg-primary" : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div
                className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/20 blur-[70px]"
                aria-hidden="true"
              />
            </article>
          </Reveal>

          {SMALL.map(({ title, description, icon: Icon }, index) => (
            <Reveal key={title} delay={index * 70}>
              <article className="lift-card shine glass-panel h-full p-6">
                <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mb-2 text-lg font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
