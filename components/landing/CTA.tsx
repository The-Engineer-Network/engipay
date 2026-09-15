"use client"

import { ArrowRight } from "lucide-react"
import { Reveal } from "@/components/marketing/Reveal"

interface CTAProps {
  onGetStarted?: () => void
}

export default function CTA({ onGetStarted }: CTAProps) {
  return (
    <section className="relative overflow-hidden py-24">
      <div className="container">
        <Reveal variant="scale">
          <div className="glass-panel relative overflow-hidden px-6 py-16 text-center sm:px-16">
            <div className="aurora opacity-70" aria-hidden="true" />

            <div className="relative">
              <h2 className="mb-5 text-balance text-3xl font-bold tracking-tight lg:text-5xl">
                Ready to move your money?
              </h2>
              <p className="mx-auto mb-10 max-w-[520px] text-base leading-relaxed text-muted-foreground lg:text-lg">
                Connect a wallet and send your first payment in under a minute. No account to
                open, nothing to download.
              </p>

              <button
                onClick={onGetStarted}
                className="glow-button group mx-auto flex w-full max-w-[280px] items-center justify-center gap-2 rounded-full bg-primary px-8 py-3.5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
              >
                Get started
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
