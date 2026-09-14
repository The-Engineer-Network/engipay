"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface NavbarProps {
  onGetStarted?: () => void
}

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
  { href: "/help", label: "Help" },
]

export default function Navbar({ onGetStarted }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // The bar stays transparent over the hero, then gains a surface once you
  // scroll, so the hero artwork is not cut off by a hard edge.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <nav
      className={cn(
        "fixed left-0 top-0 z-[1000] w-full transition-all duration-300",
        scrolled
          ? "border-b border-border bg-background/80 py-3 backdrop-blur-md"
          : "border-b border-transparent bg-transparent py-5"
      )}
    >
      <div className="container flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 text-xl font-bold">
          <Image src="/logo.svg" alt="" width={32} height={32} aria-hidden="true" />
          EngiPay
        </Link>

        <div className="hidden items-center gap-9 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="relative text-sm text-muted-foreground transition-colors after:absolute after:-bottom-1.5 after:left-0 after:h-px after:w-0 after:bg-primary after:transition-all after:duration-300 hover:text-foreground hover:after:w-full"
            >
              {link.label}
            </a>
          ))}
        </div>

        <button
          onClick={onGetStarted}
          className="glow-button hidden rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 lg:block"
        >
          Get started
        </button>

        <button
          className="text-foreground lg:hidden"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label={isOpen ? "Close menu" : "Open menu"}
        >
          {isOpen ? (
            <X className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Menu className="h-6 w-6" aria-hidden="true" />
          )}
        </button>

        {isOpen && (
          <div className="absolute left-0 top-full flex w-full flex-col gap-4 border-b border-border bg-background/95 p-5 shadow-2xl backdrop-blur-md lg:hidden">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <button
              onClick={() => {
                setIsOpen(false)
                onGetStarted?.()
              }}
              className="mt-2 w-full rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Get started
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
