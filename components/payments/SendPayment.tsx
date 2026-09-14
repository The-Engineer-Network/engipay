"use client"

import { useState } from "react"
import Link from "next/link"
import { useAccount, useSendTransaction, useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { isAddress, parseEther, parseUnits, type Address } from "viem"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Loader } from "@/components/ui/loader"
import { ExternalLink, CheckCircle2, QrCode, ClipboardPaste } from "lucide-react"
import { TRACKED_TOKENS, ERC20_ABI } from "@/lib/tokens"
import { activeChain } from "@/lib/wagmi"
import { useWallet } from "@/contexts/WalletContext"
import { cn } from "@/lib/utils"

const NATIVE = "native"

interface SendPaymentProps {
  /** Prefills the recipient, e.g. from a scanned QR code. */
  initialRecipient?: string
  /** Prefills the amount, e.g. from a payment request. */
  initialAmount?: string
}

export function SendPayment({ initialRecipient = "", initialAmount = "" }: SendPaymentProps) {
  const { isConnected } = useAccount()
  const { balances } = useWallet()
  const { toast } = useToast()

  const [recipient, setRecipient] = useState(initialRecipient)
  const [amount, setAmount] = useState(initialAmount)
  const [asset, setAsset] = useState<string>(NATIVE)

  const { sendTransactionAsync, isPending: isSendingNative } = useSendTransaction()
  const { writeContractAsync, isPending: isSendingToken } = useWriteContract()
  const [txHash, setTxHash] = useState<Address | undefined>()

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  })

  const isBusy = isSendingNative || isSendingToken || isConfirming
  const recipientValid = recipient === "" || isAddress(recipient)
  const amountValid = amount === "" || Number(amount) > 0

  const selectedSymbol =
    asset === NATIVE
      ? activeChain.nativeCurrency.symbol
      : TRACKED_TOKENS.find((token) => token.address === asset)?.symbol ?? ""

  const heldBalance = balances.find((item) => item.symbol === selectedSymbol)?.balance

  const explorerUrl = txHash
    ? `${activeChain.blockExplorers?.default.url}/tx/${txHash}`
    : undefined

  const pasteAddress = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setRecipient(text.trim())
    } catch {
      toast({
        title: "Could not read the clipboard",
        description: "Paste the address manually instead.",
        variant: "destructive",
      })
    }
  }

  const handleSend = async () => {
    if (!isConnected) {
      toast({
        title: "Wallet not connected",
        description: "Connect your wallet to send a payment.",
        variant: "destructive",
      })
      return
    }
    if (!isAddress(recipient)) {
      toast({
        title: "Invalid address",
        description: "Enter a valid wallet address.",
        variant: "destructive",
      })
      return
    }
    if (!(Number(amount) > 0)) {
      toast({
        title: "Invalid amount",
        description: "Enter an amount greater than zero.",
        variant: "destructive",
      })
      return
    }

    try {
      let hash: Address

      if (asset === NATIVE) {
        hash = await sendTransactionAsync({
          to: recipient as Address,
          value: parseEther(amount),
        })
      } else {
        const token = TRACKED_TOKENS.find((t) => t.address === asset)
        if (!token) throw new Error("Unknown token selected.")
        hash = await writeContractAsync({
          address: token.address,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [recipient as Address, parseUnits(amount, token.decimals)],
        })
      }

      setTxHash(hash)
      toast({
        title: "Transaction submitted",
        description: "Waiting for it to confirm on-chain.",
      })
    } catch (error: any) {
      // Wallets throw on user rejection; that is not an error worth alarming about.
      const rejected =
        error?.name === "UserRejectedRequestError" ||
        /user rejected|denied/i.test(error?.message ?? "")
      toast({
        title: rejected ? "Transaction cancelled" : "Payment failed",
        description: rejected
          ? "You rejected the request in your wallet."
          : error?.shortMessage || error?.message || "Something went wrong.",
        variant: "destructive",
      })
    }
  }

  if (isConfirmed && txHash) {
    return (
      <div className="glass-panel p-8 text-center">
        <span className="pulse-ring mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </span>
        <p className="text-lg font-semibold">Payment sent</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {amount} {selectedSymbol} arrived on {activeChain.name}.
        </p>
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            View on explorer
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        <Button
          variant="outline"
          className="mt-6 w-full rounded-full"
          onClick={() => {
            setTxHash(undefined)
            setRecipient("")
            setAmount("")
          }}
        >
          Send another
        </Button>
      </div>
    )
  }

  return (
    <div className="glass-panel space-y-6 p-6">
      {/* Asset picker as pills: two taps fewer than a dropdown. */}
      <div className="space-y-2">
        <Label>Asset</Label>
        <div className="flex flex-wrap gap-2">
          {[
            { value: NATIVE, symbol: activeChain.nativeCurrency.symbol, icon: "\u{1F537}" },
            ...TRACKED_TOKENS.map((token) => ({
              value: token.address as string,
              symbol: token.symbol,
              icon: token.icon,
            })),
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setAsset(option.value)}
              aria-pressed={asset === option.value}
              className={cn(
                "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                asset === option.value
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              <span aria-hidden="true">{option.icon}</span>
              {option.symbol}
            </button>
          ))}
        </div>
      </div>

      {/* Amount, shown large because it is the number people check twice. */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <Label htmlFor="amount">Amount</Label>
          {heldBalance && (
            <span className="text-xs text-muted-foreground">
              You have {heldBalance} {selectedSymbol}
            </span>
          )}
        </div>
        <div className="relative">
          <Input
            id="amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-invalid={!amountValid}
            className="h-auto border-0 bg-transparent px-0 py-2 text-4xl font-semibold tabular-nums tracking-tight focus-visible:ring-0"
          />
          <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">
            {selectedSymbol}
          </span>
        </div>
        <div className="h-px bg-border" />
        {!amountValid && (
          <p className="text-sm text-destructive">Enter an amount greater than zero.</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="recipient">Send to</Label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={pasteAddress}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ClipboardPaste className="h-3 w-3" aria-hidden="true" />
              Paste
            </button>
            <Link
              href="/scan"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <QrCode className="h-3 w-3" aria-hidden="true" />
              Scan
            </Link>
          </div>
        </div>
        <Input
          id="recipient"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder="0x..."
          spellCheck={false}
          aria-invalid={!recipientValid}
          className="font-mono text-sm"
        />
        {!recipientValid && (
          <p className="text-sm text-destructive">That is not a valid address.</p>
        )}
      </div>

      <Button
        onClick={handleSend}
        disabled={isBusy || !recipient || !amount || !recipientValid || !amountValid}
        className="glow-button h-12 w-full rounded-full text-base font-semibold"
      >
        {isBusy ? (
          <>
            <Loader className="mr-2 h-4 w-4" />
            {isConfirming ? "Confirming…" : "Check your wallet…"}
          </>
        ) : (
          `Send ${selectedSymbol}`
        )}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Sends on {activeChain.name}. On-chain transfers cannot be reversed, so check the address.
      </p>
    </div>
  )
}
