"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/contexts/WalletContext"
import dynamic from "next/dynamic"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import { TabType } from "@/types/dashboard"
import { Card, CardContent } from "@/components/ui/card"
import { Send, HandCoins, QrCode, Building2 } from "lucide-react"

const PanelSkeleton = () => (
  <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
)

// Cross-chain BTC swaps (Atomiq) are withheld from this release.
const ServicePurchase = dynamic(
  () => import("@/components/payments/ServicePurchase").then((m) => ({ default: m.ServicePurchase })),
  { loading: PanelSkeleton }
)
const PaymentModals = dynamic(
  () => import("@/components/payments/PaymentModals").then((m) => ({ default: m.PaymentModals })),
  { ssr: false }
)
const TransactionHistory = dynamic(
  () => import("@/components/payments/TransactionHistory").then((m) => ({ default: m.TransactionHistory })),
  { loading: PanelSkeleton }
)

type ModalKind = "send" | "request" | "qr" | "merchant"

const PAYMENT_OPTIONS: {
  icon: typeof Send
  title: string
  description: string
  modal: ModalKind
}[] = [
  {
    icon: Send,
    title: "Send",
    description: "Transfer funds to another wallet",
    modal: "send",
  },
  {
    icon: HandCoins,
    title: "Request",
    description: "Ask someone to pay you",
    modal: "request",
  },
  {
    icon: QrCode,
    title: "Scan QR",
    description: "Scan a code to pay",
    modal: "qr",
  },
  {
    icon: Building2,
    title: "Pay a merchant",
    description: "Wallet-to-wallet checkout",
    modal: "merchant",
  },
]

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("payments")
  const [activeModal, setActiveModal] = useState<ModalKind | null>(null)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const { isConnected } = useWallet()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const savedWallet = localStorage.getItem("engipay-wallet")
    if (!isConnected && !savedWallet) router.push("/")
  }, [mounted, isConnected, router])

  if (!mounted) return null

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    if (tab === "overview") router.push("/dashboard")
    else if (tab === "defi") router.push("/defi")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DashboardHeader />
      <DashboardNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="container space-y-10 py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Payments</h1>
          <p className="mt-1 text-muted-foreground">Send, request and track your transactions.</p>
        </header>

        <section aria-labelledby="send-money-heading">
          <h2 id="send-money-heading" className="sr-only">
            Payment actions
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PAYMENT_OPTIONS.map(({ icon: Icon, title, description, modal }) => (
              <Card key={modal} className="transition-colors hover:border-primary/40">
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() => setActiveModal(modal)}
                    className="flex w-full flex-col items-start gap-3 p-5 text-left"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block font-medium">{title}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {description}
                      </span>
                    </span>
                  </button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="services-heading">
          <h2 id="services-heading" className="sr-only">
            Services
          </h2>
          <ServicePurchase />
        </section>

        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="mb-4 text-lg font-semibold tracking-tight">
            Transaction history
          </h2>
          <TransactionHistory />
        </section>
      </main>

      <PaymentModals activeModal={activeModal} onClose={() => setActiveModal(null)} />
    </div>
  )
}
