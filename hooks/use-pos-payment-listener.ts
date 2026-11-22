"use client"

import { useEffect, useRef, useCallback } from "react"
import {
  type PosInvoice,
  type PosPaymentRecord,
  type PosBroadcastPayment,
  addDecimals,
  subtractDecimals,
  compareDecimals,
  calculatePosStatus,
  playPosChime,
  broadcastPosPayment,
  listenPosPayments,
  getAssetDecimals,
} from "@/lib/pos.ts"
import { stellarNetwork } from "@/lib/stellar.ts"
import { getPaymentRequest, recordPaymentRequestPayment } from "@/lib/api-client.ts"
import { activeChain } from "@/lib/wagmi.ts"
import { TRACKED_TOKENS } from "@/lib/tokens.ts"

interface UsePosPaymentListenerOptions {
  invoice: PosInvoice | null
  onUpdateInvoice: (updater: (prev: PosInvoice) => PosInvoice) => void
  enabled?: boolean
}

interface HorizonPaymentResponse {
  _embedded?: {
    records: Array<{
      id: string
      type: string
      created_at: string
      transaction_hash: string
      from: string
      to: string
      amount?: string
      asset_type: string
      asset_code?: string
      asset_issuer?: string
    }>
  }
}

export function usePosPaymentListener({
  invoice,
  onUpdateInvoice,
  enabled = true,
}: UsePosPaymentListenerOptions) {
  const processedTxIdsRef = useRef<Set<string>>(new Set())
  const lastBaseBalanceRef = useRef<bigint | null>(null)

  // Reset processed tx set when invoice ID changes
  useEffect(() => {
    if (invoice?.id) {
      processedTxIdsRef.current = new Set(
        invoice.payments.map((p) => p.txHash || p.id)
      )
      lastBaseBalanceRef.current = null
    }
  }, [invoice?.id])

  /**
   * Applies an incoming payment to the invoice, calculates new remaining amount,
   * flips status, plays audio chime, and syncs across tabs.
   */
  const handlePayment = useCallback(
    (payment: PosPaymentRecord) => {
      const txKey = payment.txHash || payment.id
      if (processedTxIdsRef.current.has(txKey)) {
        return
      }
      processedTxIdsRef.current.add(txKey)

      // Audio chime on cashier counter
      playPosChime()

      // Sync across browser tabs
      if (invoice) {
        broadcastPosPayment({
          type: "payment_received",
          recipient: invoice.recipientAddress,
          amount: payment.amount,
          asset: payment.asset,
          txHash: payment.txHash || payment.id,
          chain: payment.chain,
          requestId: invoice.apiRequestId,
        })
      }

      // Record on backend if this invoice is registered with EngiPay API
      if (invoice?.apiRequestId) {
        recordPaymentRequestPayment(invoice.apiRequestId, {
          amount: payment.amount,
          chain: payment.chain,
          tx_hash: payment.txHash,
          payer_address: payment.payer,
          note: payment.note,
        }).catch(() => {
          // Ignore backend record conflicts if already logged
        })
      }

      onUpdateInvoice((prev) => {
        if (!prev) return prev
        const decimals = getAssetDecimals(prev.asset, prev.chain)
        const newPaid = addDecimals(prev.amountPaid, payment.amount, decimals)
        const newRemaining = subtractDecimals(prev.amount, newPaid, decimals)
        const newStatus = calculatePosStatus(
          prev.amount,
          newPaid,
          prev.expiresAt,
          Date.now(),
          decimals
        )

        return {
          ...prev,
          amountPaid: newPaid,
          amountRemaining: newRemaining,
          status: newStatus,
          payments: [...prev.payments, payment],
        }
      })
    },
    [invoice, onUpdateInvoice]
  )

  // 1. Cross-tab Broadcast Channel listener
  useEffect(() => {
    if (!enabled || !invoice || invoice.status === "paid" || invoice.status === "expired") {
      return
    }

    const unsubscribe = listenPosPayments((msg: PosBroadcastPayment) => {
      if (
        msg.recipient.toLowerCase() === invoice.recipientAddress.toLowerCase() ||
        (invoice.apiRequestId && msg.requestId === invoice.apiRequestId)
      ) {
        handlePayment({
          id: `broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          amount: msg.amount,
          asset: msg.asset,
          chain: msg.chain,
          txHash: msg.txHash,
          createdAt: new Date().toISOString(),
        })
      }
    })

    return unsubscribe
  }, [enabled, invoice, handlePayment])

  // 2. Stellar Horizon Testnet watcher
  useEffect(() => {
    if (
      !enabled ||
      !invoice ||
      invoice.chain !== "stellar" ||
      invoice.status === "paid" ||
      invoice.status === "expired" ||
      !invoice.recipientAddress
    ) {
      return
    }

    let isCancelled = false
    const recipient = invoice.recipientAddress
    const horizonUrl = stellarNetwork.horizonUrl

    const checkStellarPayments = async () => {
      try {
        const res = await fetch(
          `${horizonUrl}/accounts/${encodeURIComponent(recipient)}/payments?order=desc&limit=10`,
          { headers: { Accept: "application/json" } }
        )
        if (!res.ok) return
        const data = (await res.json()) as HorizonPaymentResponse
        const records = data._embedded?.records ?? []

        for (const record of records) {
          if (isCancelled) break
          if (record.to !== recipient || !record.amount) continue

          // Check asset
          const isXlm = invoice.asset.toUpperCase() === "XLM" && record.asset_type === "native"
          const isUsdc =
            invoice.asset.toUpperCase() === "USDC" &&
            record.asset_code === "USDC" &&
            (!record.asset_issuer || record.asset_issuer === stellarNetwork.usdcIssuer)

          if (!isXlm && !isUsdc) continue

          // Check timestamp (allow 30s buffer before invoice creation)
          const recordTime = new Date(record.created_at).getTime()
          if (recordTime < invoice.createdAt - 30000) continue

          const txKey = record.transaction_hash || record.id
          if (!processedTxIdsRef.current.has(txKey)) {
            handlePayment({
              id: record.id,
              amount: record.amount,
              asset: invoice.asset,
              chain: "stellar",
              txHash: record.transaction_hash,
              payer: record.from,
              createdAt: record.created_at,
            })
          }
        }
      } catch (err) {
        // Horizon network poll error - silently retry on next tick
      }
    }

    // Initial check
    checkStellarPayments()

    // Poll every 2 seconds
    const interval = setInterval(checkStellarPayments, 2000)

    return () => {
      isCancelled = true
      clearInterval(interval)
    }
  }, [enabled, invoice, handlePayment])

  // 3. Base Sepolia EVM watcher
  useEffect(() => {
    if (
      !enabled ||
      !invoice ||
      invoice.chain !== "base" ||
      invoice.status === "paid" ||
      invoice.status === "expired" ||
      !invoice.recipientAddress
    ) {
      return
    }

    let isCancelled = false
    const recipient = invoice.recipientAddress
    const rpcUrl = activeChain.rpcUrls.default.http[0]
    const isEth = invoice.asset.toUpperCase() === "ETH"

    const checkBasePayments = async () => {
      try {
        if (isEth) {
          const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getBalance",
              params: [recipient, "latest"],
            }),
          })
          if (!res.ok) return
          const json = await res.json()
          if (json.result) {
            const currentBalance = BigInt(json.result)
            if (lastBaseBalanceRef.current !== null && currentBalance > lastBaseBalanceRef.current) {
              const diff = currentBalance - lastBaseBalanceRef.current
              const whole = diff / 10n ** 18n
              const frac = (diff % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "")
              const amountReceived = frac ? `${whole}.${frac}` : whole.toString()

              handlePayment({
                id: `eth-${Date.now()}`,
                amount: amountReceived,
                asset: "ETH",
                chain: "base",
                txHash: `0x${Date.now().toString(16)}`,
                createdAt: new Date().toISOString(),
              })
            }
            lastBaseBalanceRef.current = currentBalance
          }
        } else {
          // ERC-20 USDC watcher on Base
          const token = TRACKED_TOKENS.find(
            (t) => t.symbol.toUpperCase() === invoice.asset.toUpperCase()
          )
          if (!token) return

          // Call balanceOf via eth_call
          // selector for balanceOf(address): 0x70a08231 + 32-byte padded address
          const cleanAddress = recipient.toLowerCase().replace(/^0x/, "").padStart(64, "0")
          const callData = `0x70a08231${cleanAddress}`

          const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "eth_call",
              params: [{ to: token.address, data: callData }, "latest"],
            }),
          })
          if (!res.ok) return
          const json = await res.json()
          if (json.result && json.result !== "0x") {
            const currentBalance = BigInt(json.result)
            if (lastBaseBalanceRef.current !== null && currentBalance > lastBaseBalanceRef.current) {
              const diff = currentBalance - lastBaseBalanceRef.current
              const divisor = 10n ** BigInt(token.decimals)
              const whole = diff / divisor
              const frac = (diff % divisor)
                .toString()
                .padStart(token.decimals, "0")
                .replace(/0+$/, "")
              const amountReceived = frac ? `${whole}.${frac}` : whole.toString()

              handlePayment({
                id: `erc20-${Date.now()}`,
                amount: amountReceived,
                asset: invoice.asset,
                chain: "base",
                txHash: `0x${Date.now().toString(16)}`,
                createdAt: new Date().toISOString(),
              })
            }
            lastBaseBalanceRef.current = currentBalance
          }
        }
      } catch (err) {
        // RPC network poll error - retry next tick
      }
    }

    checkBasePayments()
    const interval = setInterval(checkBasePayments, 2500)

    return () => {
      isCancelled = true
      clearInterval(interval)
    }
  }, [enabled, invoice, handlePayment])

  // 4. Backend API polling (for registered payment requests)
  useEffect(() => {
    if (
      !enabled ||
      !invoice ||
      !invoice.apiRequestId ||
      invoice.status === "paid" ||
      invoice.status === "expired"
    ) {
      return
    }

    let isCancelled = false
    const requestId = invoice.apiRequestId

    const checkApiStatus = async () => {
      try {
        const detail = await getPaymentRequest(requestId)
        if (isCancelled || !detail) return

        for (const payment of detail.payments) {
          const key = payment.tx_hash || payment.id
          if (!processedTxIdsRef.current.has(key)) {
            handlePayment({
              id: payment.id,
              amount: payment.amount,
              asset: payment.asset,
              chain: payment.chain,
              txHash: payment.tx_hash,
              payer: payment.payer_address,
              note: payment.note,
              createdAt: payment.created_at,
            })
          }
        }

        if (detail.status === "paid" && invoice.status !== "paid") {
          onUpdateInvoice((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              status: "paid",
              amountPaid: detail.amount_paid,
              amountRemaining: "0",
            }
          })
          playPosChime()
        }
      } catch {
        // Public API poll error - retry next interval
      }
    }

    const interval = setInterval(checkApiStatus, 2000)
    return () => {
      isCancelled = true
      clearInterval(interval)
    }
  }, [enabled, invoice, handlePayment, onUpdateInvoice])

  // Helper for manual simulation / testnet demo triggers
  const triggerSimulatedPayment = useCallback(
    (simulatedAmount?: string) => {
      if (!invoice) return
      const amountToPay = simulatedAmount || invoice.amountRemaining
      const simulatedTxHash = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

      handlePayment({
        id: `sim-${Date.now()}`,
        amount: amountToPay,
        asset: invoice.asset,
        chain: invoice.chain,
        txHash: simulatedTxHash,
        payer: "Simulated Testnet Wallet",
        note: "Testnet Simulation",
        createdAt: new Date().toISOString(),
      })
    },
    [invoice, handlePayment]
  )

  return {
    triggerSimulatedPayment,
  }
}
