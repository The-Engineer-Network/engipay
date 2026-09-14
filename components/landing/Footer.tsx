import Image from "next/image"
import Link from "next/link"

const PRODUCT = [
  { href: "/features", label: "Features" },
  { href: "/technology", label: "Technology" },
  { href: "/dashboard", label: "Open app" },
]

const COMPANY = [
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
]

const SUPPORT = [
  { href: "/help", label: "Help centre" },
  { href: "/privacy", label: "Privacy" },
]

export default function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t border-border bg-card pb-10 pt-16">
      <div className="container">
        <div className="mb-14 grid grid-cols-2 gap-10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="col-span-2 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5 text-xl font-bold text-foreground">
              <Image src="/logo.svg" alt="" width={24} height={24} aria-hidden="true" />
              EngiPay
            </div>
            <p className="mt-4 max-w-[420px] leading-relaxed text-muted-foreground">
              Crypto payments for Nigeria. Send and receive, pay by scanning a code, and move
              money between crypto and Naira.
            </p>
          </div>

          <div>
            <h4 className="mb-5 font-semibold text-foreground">Product</h4>
            <ul className="flex flex-col gap-3">
              {PRODUCT.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-5 font-semibold text-foreground">Company</h4>
            <ul className="flex flex-col gap-3">
              {COMPANY.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-5 font-semibold text-foreground">Support</h4>
            <ul className="flex flex-col gap-3">
              {SUPPORT.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-8 text-sm text-muted-foreground md:flex-row">
          <p>&copy; {currentYear} EngiPay. All rights reserved.</p>
          <p>Built in Nigeria.</p>
        </div>
      </div>
    </footer>
  )
}
