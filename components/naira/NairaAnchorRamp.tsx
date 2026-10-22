"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertCircle,
  Landmark,
  RefreshCw,
  ShieldCheck,
  ChevronRight,
} from "lucide-react"
import {
  SUPPORTED_NIGERIAN_BANKS,
  isValidNuban,
  isSep24Terminal,
} from "@/lib/naira-ramp"
import {
  startNairaDeposit,
  getNairaDepositStatus,
  startNairaWithdrawal,
  getNairaWithdrawalStatus,
  type InteractiveFlowResponse,
  type AnchorTransactionStatus,
} from "@/lib/api-client"

export function NairaAnchorRamp({ defaultTab = "deposit" }: { defaultTab?: "deposit" | "withdraw" }) {
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">(defaultTab)

  // Deposit state
  const [depositAmount, setDepositAmount] = useState("10000")
  const [isStartingDeposit, setIsStartingDeposit] = useState(false)
  const [depositTx, setDepositTx] = useState<InteractiveFlowResponse | null>(null)
  const [depositStatus, setDepositStatus] = useState<AnchorTransactionStatus | null>(null)

  // Withdrawal state
  const [withdrawAmount, setWithdrawAmount] = useState("25.00")
  const [bankCode, setBankCode] = useState("058") // GTBank default
  const [accountNumber, setAccountNumber] = useState("")
  const [accountName, setAccountName] = useState("")
  const [isStartingWithdrawal, setIsStartingWithdrawal] = useState(false)
  const [withdrawTx, setWithdrawTx] = useState<InteractiveFlowResponse | null>(null)
  const [withdrawStatus, setWithdrawStatus] = useState<AnchorTransactionStatus | null>(null)

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Polling deposit status
  useEffect(() => {
    if (!depositTx) return
    const interval = setInterval(async () => {
      try {
        const status = await getNairaDepositStatus(depositTx.transaction_id)
        setDepositStatus(status)
        if (isSep24Terminal(status.status)) {
          clearInterval(interval)
        }
      } catch (err) {
        console.error("Failed to poll deposit status", err)
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [depositTx])

  // Polling withdrawal status
  useEffect(() => {
    if (!withdrawTx) return
    const interval = setInterval(async () => {
      try {
        const status = await getNairaWithdrawalStatus(withdrawTx.transaction_id)
        setWithdrawStatus(status)
        if (isSep24Terminal(status.status)) {
          clearInterval(interval)
        }
      } catch (err) {
        console.error("Failed to poll withdrawal status", err)
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [withdrawTx])

  const handleStartDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      setErrorMsg("Please enter a valid deposit amount")
      return
    }

    setIsStartingDeposit(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      const res = await startNairaDeposit({ amount: depositAmount })
      setDepositTx(res)
      setSuccessMsg("Interactive SEP-24 deposit initiated. Complete the checkout window to receive funds.")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to initiate Naira deposit"
      setErrorMsg(msg)
    } finally {
      setIsStartingDeposit(false)
    }
  }

  const handleStartWithdrawal = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      setErrorMsg("Please enter a valid withdrawal amount")
      return
    }
    if (!isValidNuban(accountNumber)) {
      setErrorMsg("Please enter a valid 10-digit Nigerian NUBAN account number")
      return
    }
    if (!accountName.trim()) {
      setErrorMsg("Please enter the bank account holder name")
      return
    }

    setIsStartingWithdrawal(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      const res = await startNairaWithdrawal({
        amount: withdrawAmount,
        bank_code: bankCode,
        bank_account: accountNumber.trim(),
        account_name: accountName.trim(),
      })
      setWithdrawTx(res)
      setSuccessMsg("Withdrawal initiated. Cash will be disbursed to your Nigerian bank account.")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to initiate Naira withdrawal"
      setErrorMsg(msg)
    } finally {
      setIsStartingWithdrawal(false)
    }
  }

  return (
    <Card className="border border-border shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Naira Anchor (SEP-24)</CardTitle>
            <CardDescription>
              Direct on-ramp & off-ramp via regulated Stellar anchors (Cowrie / SDF Testnet).
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-primary/40 text-primary">
            SEP-24 Ramp
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as "deposit" | "withdraw")
            setErrorMsg(null)
            setSuccessMsg(null)
          }}
          className="space-y-6"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deposit" className="flex items-center gap-2">
              <ArrowDownLeft className="h-4 w-4" />
              Deposit Naira (Buy Crypto)
            </TabsTrigger>
            <TabsTrigger value="withdraw" className="flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4" />
              Withdraw to Bank (Sell Crypto)
            </TabsTrigger>
          </TabsList>

          {/* DEPOSIT TAB */}
          <TabsContent value="deposit" className="space-y-4">
            {!depositTx ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="deposit-amount">Amount (NGN)</Label>
                    <Input
                      id="deposit-amount"
                      type="number"
                      step="any"
                      placeholder="10000"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="deposit-asset">You receive</Label>
                    <p
                      id="deposit-asset"
                      className="flex h-10 items-center rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      USDC on Stellar
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p>
                    <strong>How it works:</strong> You will be directed to the anchor&apos;s interactive
                    SEP-24 window to transfer Naira via bank transfer or card. Once received, USDC will
                    be credited to your EngiPay ledger automatically.
                  </p>
                </div>

                <Button
                  onClick={handleStartDeposit}
                  disabled={isStartingDeposit}
                  className="w-full h-11 font-semibold"
                >
                  {isStartingDeposit ? "Connecting to Anchor..." : "Start Naira Deposit"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Deposit Session Active</span>
                    <Badge variant={depositStatus?.status === "completed" ? "default" : "secondary"}>
                      {depositStatus?.status || "initiated"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">
                    Transaction ID: {depositTx.transaction_id}
                  </p>

                  <a
                    href={depositTx.interactive_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Open Anchor Payment Window
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Tracking status live from Stellar anchor...</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDepositTx(null)
                      setDepositStatus(null)
                    }}
                  >
                    Start New Deposit
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* WITHDRAW TAB */}
          <TabsContent value="withdraw" className="space-y-4">
            {!withdrawTx ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="withdraw-amount">Amount (USDC)</Label>
                    <Input
                      id="withdraw-amount"
                      type="number"
                      step="any"
                      placeholder="25.00"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="withdraw-asset">You sell</Label>
                    <p
                      id="withdraw-asset"
                      className="flex h-10 items-center rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      USDC on Stellar
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bank-select">Nigerian Bank</Label>
                  <Select value={bankCode} onValueChange={setBankCode}>
                    <SelectTrigger id="bank-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_NIGERIAN_BANKS.map((b) => (
                        <SelectItem key={b.code} value={b.code}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="nuban-input">NUBAN Account Number (10 digits)</Label>
                    <Input
                      id="nuban-input"
                      placeholder="0123456789"
                      maxLength={10}
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="account-name">Account Holder Name</Label>
                    <Input
                      id="account-name"
                      placeholder="Jane Doe"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                    />
                  </div>
                </div>

                <Button
                  onClick={handleStartWithdrawal}
                  disabled={isStartingWithdrawal}
                  className="w-full h-11 font-semibold"
                >
                  {isStartingWithdrawal ? "Initiating Payout..." : "Withdraw to Bank Account"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Withdrawal In Progress</span>
                    <Badge variant={withdrawStatus?.status === "completed" ? "default" : "secondary"}>
                      {withdrawStatus?.status || "pending_anchor"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">
                    Transaction ID: {withdrawTx.transaction_id}
                  </p>

                  <a
                    href={withdrawTx.interactive_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    View Anchor Settlement Receipt
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Tracking bank payout status...</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setWithdrawTx(null)
                      setWithdrawStatus(null)
                    }}
                  >
                    Start New Withdrawal
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {errorMsg && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-success text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
