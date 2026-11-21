"use client"

import { useEffect, useState } from "react"
import { AccountCard } from "@/components/app/AccountCard"
import { AddBankAccountForm } from "@/components/app/AddBankAccountForm"
import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { Copy, Download } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { useStellarWallet } from "@/contexts/StellarWalletContext"
import { stellarNetwork } from "@/lib/stellar"
import { activeChain } from "@/lib/wagmi"
import { shortenAddress } from "@/lib/payment-uri"
import {
  exportData,
  requestAccountDeletion,
  getDeletionRequest,
  listBankAccounts,
  removeBankAccount,
  type BankAccount,
  type DeletionRequest,
} from "@/lib/api-client"

const DELETION_CONFIRMATION = "DELETE"

export default function SettingsPage() {
  const { evmAddress: walletAddress, walletName, disconnectWallet, connectWallet } = useWallet()
  const { stellarAddress, stellarWalletName, networkMismatch, disconnectStellar } = useStellarWallet()
  const { toast } = useToast()
  const [isExporting, setIsExporting] = useState(false)
  const [deletionRequest, setDeletionRequest] = useState<DeletionRequest | null>(null)
  const [isLoadingDeletion, setIsLoadingDeletion] = useState(true)
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false)
  const [deletionConfirmation, setDeletionConfirmation] = useState("")
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [isLoadingBankAccounts, setIsLoadingBankAccounts] = useState(true)
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getDeletionRequest()
      .then((request) => {
        if (!cancelled) setDeletionRequest(request)
      })
      .catch(() => {
        if (!cancelled) setDeletionRequest(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDeletion(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    listBankAccounts()
      .then((accounts) => {
        if (!cancelled) setBankAccounts(accounts)
      })
      .catch(() => {
        if (!cancelled) setBankAccounts([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBankAccounts(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const copyAddress = async (address: string | null = walletAddress) => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      toast({ title: "Address copied" })
    } catch {
      toast({ title: "Could not copy the address", variant: "destructive" })
    }
  }

  const downloadData = async () => {
    setIsExporting(true)
    try {
      const data = await exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "my-data.json"
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast({ title: "Your data has been downloaded" })
    } catch {
      toast({ title: "Could not download your data", variant: "destructive" })
    } finally {
      setIsExporting(false)
    }
  }

  const requestDeletion = async () => {
    if (deletionConfirmation !== DELETION_CONFIRMATION) return
    setIsRequestingDeletion(true)
    try {
      const request = await requestAccountDeletion()
      setDeletionRequest(request)
      setDeletionConfirmation("")
      toast({ title: "Account deletion requested" })
    } catch {
      toast({ title: "Could not request account deletion", variant: "destructive" })
    } finally {
      setIsRequestingDeletion(false)
    }
  }

  const removeAccount = async (id: string) => {
    setRemovingId(id)
    try {
      await removeBankAccount(id)
      setBankAccounts((accounts) => accounts.filter((account) => account.id !== id))
      setPendingRemovalId(null)
      toast({ title: "Bank account removed" })
    } catch {
      toast({ title: "Could not remove the bank account", variant: "destructive" })
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Connected with</span>
            <span className="text-sm font-medium">{walletAddress ? walletName ?? "—" : "—"}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Address</span>
            {walletAddress ? (
              <button
                type="button"
                onClick={() => copyAddress()}
                className="flex items-center gap-2 font-mono text-sm transition-colors hover:text-primary"
              >
                {shortenAddress(walletAddress, 8, 6)}
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <span className="text-sm">—</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Network</span>
            <span className="text-sm font-medium">{activeChain.name}</span>
          </div>

          <Button variant="outline" className="w-full" onClick={disconnectWallet}>
            Disconnect wallet
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stellar wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Address</span>
            {stellarAddress ? (
              <button
                type="button"
                onClick={() => copyAddress(stellarAddress)}
                className="flex items-center gap-2 font-mono text-sm transition-colors hover:text-primary"
              >
                {shortenAddress(stellarAddress, 8, 6)}
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <span className="text-sm">Not connected</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Network</span>
            <span className="text-sm font-medium">{stellarNetwork.label}</span>
          </div>

          {networkMismatch && <p className="text-sm text-warning">{networkMismatch}</p>}

          {stellarAddress ? (
            <Button variant="outline" className="w-full" onClick={disconnectStellar}>
              Disconnect {stellarWalletName ?? "Stellar wallet"}
            </Button>
          ) : (
            <Button variant="outline" className="w-full" onClick={connectWallet}>
              Connect a Stellar wallet
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bank accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingBankAccounts ? (
            <p className="text-sm text-muted-foreground">Loading bank accounts…</p>
          ) : bankAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bank accounts added yet.</p>
          ) : (
            <ul className="space-y-3">
              {bankAccounts.map((account) => (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-4 rounded-md border p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium">{account.bankName}</p>
                    <p className="font-mono text-sm text-muted-foreground">
                      {account.maskedAccountNumber}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {account.accountName}
                    </p>
                  </div>
                  {pendingRemovalId === account.id ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => removeAccount(account.id)}
                        disabled={removingId === account.id}
                      >
                        {removingId === account.id ? "Removing…" : "Confirm"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPendingRemovalId(null)}
                        disabled={removingId === account.id}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setPendingRemovalId(account.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download a copy of your account data as a JSON file.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={downloadData}
            disabled={isExporting}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {isExporting ? "Preparing download…" : "Download my data"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingDeletion ? (
            <p className="text-sm text-muted-foreground">Checking deletion request status…</p>
          ) : deletionRequest ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Your account deletion request has been received.
              </p>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground">Status</span>
                <span className="text-sm font-medium capitalize">{deletionRequest.status}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Request deletion of your account and all associated data. Type {DELETION_CONFIRMATION} to
                confirm.
              </p>
              <Input
                value={deletionConfirmation}
                onChange={(event) => setDeletionConfirmation(event.target.value)}
                placeholder={DELETION_CONFIRMATION}
                aria-label="Type DELETE to confirm account deletion"
              />
              <Button
                variant="destructive"
                className="w-full"
                onClick={requestDeletion}
                disabled={
                  deletionConfirmation !== DELETION_CONFIRMATION || isRequestingDeletion
                }
              >
                {isRequestingDeletion ? "Requesting…" : "Request account deletion"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
