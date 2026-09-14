"use client"

import Image from "next/image"
import { useEffect, useRef } from "react"
import { ArrowRight, QrCode, Bitcoin, Wallet, Banknote, Check } from "lucide-react"
import { Reveal } from "@/components/marketing/Reveal"

interface HeroProps {
  onGetStarted?: () => void
}

const TRUST = [
  { icon: Wallet, label: "Any wallet" },
  { icon: Bitcoin, label: "Real Bitcoin" },
  { icon: QrCode, label: "Scan to pay" },
]

export default function Hero({ onGetStarted }: HeroProps) {
  const sceneRef = useRef<HTMLDivElement>(null)

  /**
   * Parallax: the artwork leans towards the pointer. Written straight to CSS
   * variables inside a rAF so it never triggers a React render, and skipped
   * entirely on touch devices and for reduced-motion users.
   */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return

    let frame = 0

    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = scene.getBoundingClientRect()
        const x = (event.clientX - rect.left) / rect.width - 0.5
        const y = (event.clientY - rect.top) / rect.height - 0.5
        scene.style.setProperty("--tilt-x", `${(-y * 10).toFixed(2)}deg`)
        scene.style.setProperty("--tilt-y", `${(x * 12).toFixed(2)}deg`)
        scene.style.setProperty("--shift-x", `${(x * 14).toFixed(1)}px`)
        scene.style.setProperty("--shift-y", `${(y * 14).toFixed(1)}px`)
      })
    }

    const onLeave = () => {
      cancelAnimationFrame(frame)
      scene.style.setProperty("--tilt-x", "0deg")
      scene.style.setProperty("--tilt-y", "0deg")
      scene.style.setProperty("--shift-x", "0px")
      scene.style.setProperty("--shift-y", "0px")
    }

    window.addEventListener("pointermove", onMove, { passive: true })
    scene.addEventListener("pointerleave", onLeave)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", onMove)
      scene.removeEventListener("pointerleave", onLeave)
    }
  }, [])

  return (
    <section className="relative overflow-hidden pb-24 pt-32 lg:pb-32 lg:pt-40">
      <div className="aurora" aria-hidden="true" />
      <div className="grid-fade" aria-hidden="true" />

      <div className="container relative">
        <div className="flex flex-col items-center gap-16 lg:flex-row lg:gap-10">
          {/* Copy */}
          <div className="flex-1 text-center lg:text-left">
            <Reveal>
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
                Naira and crypto, one app
              </span>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="mb-6 text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-[4.25rem]">
                <span className="text-gradient">Money that moves</span>
                <br />
                as fast as you do.
              </h1>
            </Reveal>

            <Reveal delay={160}>
              <p className="mx-auto mb-10 max-w-[520px] text-base leading-relaxed text-muted-foreground lg:mx-0 lg:text-lg">
                Send and receive crypto, get paid by scanning a code, send real Bitcoin, and cash
                out to Naira in your bank account.
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
                <button
                  onClick={onGetStarted}
                  className="glow-button group flex w-full max-w-[280px] items-center justify-center gap-2 rounded-full bg-primary px-8 py-3.5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
                >
                  Get started
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </button>
                <a
                  href="#how-it-works"
                  className="flex w-full max-w-[280px] items-center justify-center rounded-full border border-border px-8 py-3.5 font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-accent sm:w-auto"
                >
                  See how it works
                </a>
              </div>
            </Reveal>

            <Reveal delay={320}>
              <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 lg:justify-start">
                {TRUST.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* Artwork */}
          <Reveal variant="scale" delay={200} className="w-full flex-1">
            <div
              ref={sceneRef}
              className="relative mx-auto w-full max-w-[460px] [perspective:1400px]"
            >
              <div
                className="absolute -inset-10 rounded-full bg-primary/20 opacity-40 blur-[90px]"
                aria-hidden="true"
              />

              <div
                className="relative transition-transform duration-300 ease-out [transform-style:preserve-3d]"
                style={{
                  transform:
                    "rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg)) translate3d(var(--shift-x, 0px), var(--shift-y, 0px), 0)",
                }}
              >
                <div className="relative mx-auto aspect-[3/4] w-full max-w-[380px]">
                  <Image
                    src="/phone.png"
                    alt="The EngiPay app on a phone"
                    fill
                    priority
                    className="object-contain drop-shadow-[0_30px_60px_hsl(150_40%_3%/0.6)]"
                  />
                </div>

                {/* Floating cards, each at its own depth so the parallax separates them. */}
                <div
                  className="float-slow glass-panel absolute -left-2 top-[18%] w-[190px] p-3.5 shadow-xl sm:-left-6"
                  style={{ transform: "translateZ(60px)" }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="text-xs text-muted-foreground">Cashed out</span>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">₦48,250</p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    Paid to your bank
                  </p>
                </div>

                <div
                  className="float-slower glass-panel absolute -right-2 top-[46%] w-[176px] p-3.5 shadow-xl sm:-right-6"
                  style={{ transform: "translateZ(90px)" }}
                >
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Scan to pay</span>
                    <QrCode className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  </div>
                  <div
                    className="grid grid-cols-5 gap-[3px] rounded-md bg-foreground/5 p-2"
                    aria-hidden="true"
                  >
                    {/* A QR-ish pattern, drawn rather than loaded as an image. */}
                    {[
                      1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1,
                    ].map((on, index) => (
                      <span
                        key={index}
                        className={`aspect-square rounded-[2px] ${on ? "bg-primary" : "bg-transparent"}`}
                      />
                    ))}
                  </div>
                </div>

                <div
                  className="float-slow glass-panel absolute bottom-[8%] left-[12%] w-[164px] p-3 shadow-xl"
                  style={{ transform: "translateZ(40px)", animationDelay: "-1.5s" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Bitcoin className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium">BTC sent</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        Wallet to wallet
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
