"use client"

import { useState, useCallback, useEffect } from "react"
import { PosInvoiceForm } from "./PosInvoiceForm"
import { PosDisplay } from "./PosDisplay"
import { type PosInvoice, type PosPaymentRecord } from "@/lib/pos"
import { usePosPaymentListener } from "@/hooks/use-pos-payment-listener"
import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Receipt, CheckCircle, ArrowRight } from "lucide-react"

const RECENT_SALES_KEY = "engipay-pos-recent-sales"

export function PosCounter() {
  const [activeInvoice, setActiveInvoice] = useState<PosInvoice | null>(null)
  const [recentSales, setRecentSales] = useState<PosInvoice[]>([])

  // Load recent sales from local storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SALES_KEY)
      if (stored) {
        setRecentSales(JSON.parse(stored))
      }
    } catch {
      // Ignore local storage parse errors
    }
  }, [])

  // Save recent sales to local storage
  const saveSaleToHistory = useCallback((invoice: PosInvoice) => {
    setRecentSales((prev) => {
      const updated = [invoice, ...prev.filter((i) => i.id !== invoice.id)].slice(0, 10)
      try {
        localStorage.setItem(RECENT_SALES_KEY, JSON.stringify(updated))
      } catch {}
      return updated
    })
  }, [])

  // Real-time listener for Stellar Testnet, Base Sepolia, backend API & cross-tab sync
  const { triggerSimulatedPayment } = usePosPaymentListener({
    invoice: activeInvoice,
    onUpdateInvoice: (updater) => {
      setActiveInvoice((prev) => {
        if (!prev) return prev
        const updated = updater(prev)
        if (updated.status === "paid") {
          saveSaleToHistory(updated)
        }
        return updated
      })
    },
    enabled: Boolean(activeInvoice),
  })

  const handleCreateInvoice = (invoice: PosInvoice) => {
    setActiveInvoice(invoice)
  }

  const handleNewSale = () => {
    setActiveInvoice(null)
  }

  const handleSimulatePayment = (amount?: string) => {
    triggerSimulatedPayment(amount)
  }

  return (
    <div className="space-y-6">
      {!activeInvoice ? (
        <div className="space-y-6">
          <PageHeader
            title="Point of Sale (POS)"
            description="Generate instant QR payment requests for your shop counter. Flips to paid automatically when customer payment arrives."
          />

          <div className="grid gap-6 md:grid-cols-12">
            <div className="md:col-span-8">
              <PosInvoiceForm onCreateInvoice={handleCreateInvoice} />
            </div>

            {/* Recent counter sales history panel */}
            <div className="md:col-span-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                  Recent Counter Sales
                </h3>
                {recentSales.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setRecentSales([])
                      localStorage.removeItem(RECENT_SALES_KEY)
                    }}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>

              {recentSales.length > 0 ? (
                <div className="space-y-2">
                  {recentSales.map((sale) => (
                    <Card key={sale.id} className="p-3 text-xs glass-panel">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-emerald-500" />
                          <div>
                            <span className="font-bold text-foreground">
                              {sale.amountPaid} {sale.asset}
                            </span>
                            {sale.note && (
                              <span className="block text-[11px] text-muted-foreground">
                                {sale.note}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right text-[11px] text-muted-foreground">
                          <span className="block capitalize font-medium text-foreground">
                            {sale.chain}
                          </span>
                          <span>
                            {new Date(sale.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  Completed counter sales will appear here.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <PosDisplay
          invoice={activeInvoice}
          onNewSale={handleNewSale}
          onSimulatePayment={handleSimulatePayment}
          onUpdateInvoice={(updater) => {
            setActiveInvoice((prev) => {
              if (!prev) return prev
              const updated = updater(prev)
              if (updated.status === "paid") {
                saveSaleToHistory(updated)
              }
              return updated
            })
          }}
        />
      )}
    </div>
  )
}
