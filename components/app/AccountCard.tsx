"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { PendingServiceNote } from "@/components/app/PendingServiceNote"
import { useWallet } from "@/contexts/WalletContext"
import { useEvmSignIn } from "@/hooks/use-evm-sign-in"
import { useToast } from "@/hooks/use-toast"
import { ApiRequestError, apiRequest, readSessionToken } from "@/lib/api"
import { checkTag } from "@/lib/tags"

/** The signed-in user's profile, as GET /v1/me returns it. */
interface Profile {
  tag: string | null
  tier: number
  daily_limit: string
}

/**
 * The Account section of Settings: the user's tag, KYC tier and daily limit,
 * with a form to set the tag. With no session it offers to sign in with the
 * connected Ethereum wallet.
 */
export function AccountCard() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { evmAddress, connectWallet } = useWallet()
  const { signIn, isSigning } = useEvmSignIn()
  const [hasSession, setHasSession] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [serverError, setServerError] = useState<string | null>(null)

  // The session lives in localStorage, so it is only known after mount. It is
  // re-read when the wallet changes, because disconnecting clears it.
  useEffect(() => setHasSession(readSessionToken() !== null), [evmAddress])

  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: async () => (await apiRequest<Profile>("/v1/me")) as Profile,
    enabled: hasSession,
    retry: false,
  })

  // An expired session comes back as 401: fall back to the sign-in prompt.
  useEffect(() => {
    if (profile.error instanceof ApiRequestError && profile.error.status === 401) {
      setHasSession(false)
    }
  }, [profile.error])

  const saveTag = useMutation({
    mutationFn: (tag: string) =>
      apiRequest<void>("/v1/me", { method: "PATCH", body: JSON.stringify({ tag }) }),
    onSuccess: (_result, tag) => {
      setServerError(null)
      setDraft("")
      toast({ title: `Tag saved as @${tag}` })
      void queryClient.invalidateQueries({ queryKey: ["profile"] })
    },
    onError: (error) => {
      // Keep what the user typed, so they can change it and try again.
      setServerError(
        error instanceof ApiRequestError ? error.message : "Could not save the tag. Try again."
      )
    },
  })

  const check = draft === "" ? null : checkTag(draft)
  const inlineError = check && !check.ok ? check.reason : null
  const currentTag = profile.data?.tag ?? null
  const unchanged = check?.ok === true && check.tag === currentTag
  const canSave = check?.ok === true && !unchanged && !saveTag.isPending

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!check || !check.ok || !canSave) return
    setServerError(null)
    saveTag.mutate(check.tag)
  }

  async function handleSignIn() {
    if (!evmAddress) return
    setSignInError(null)
    try {
      await signIn(evmAddress)
      setHasSession(true)
      void queryClient.invalidateQueries({ queryKey: ["profile"] })
    } catch (error) {
      setSignInError(
        error instanceof ApiRequestError
          ? error.message
          : "Sign-in did not finish. Check your wallet and try again."
      )
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasSession ? (
          evmAddress ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sign in with your wallet to see your tag, tier and daily limit. Your wallet will ask
                you to sign a message. This does not send anything.
              </p>
              <Button
                type="button"
                className="w-full"
                onClick={handleSignIn}
                disabled={isSigning}
              >
                {isSigning ? "Waiting for your wallet…" : "Sign in with your wallet"}
              </Button>
              {signInError && (
                <p role="alert" className="text-xs text-destructive">
                  {signInError}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <PendingServiceNote>
                Sign in with an Ethereum wallet to see your tag, tier and daily limit. Stellar sign-in
                is not available yet.
              </PendingServiceNote>
              <Button type="button" variant="outline" className="w-full" onClick={connectWallet}>
                Connect a wallet
              </Button>
            </div>
          )
        ) : profile.isPending ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading your account">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : profile.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {profile.error instanceof ApiRequestError
              ? profile.error.message
              : "Could not load your account."}
          </p>
        ) : (
          <>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Tag</dt>
                <dd className="font-medium">{currentTag ? `@${currentTag}` : "Not set"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Tier</dt>
                <dd className="font-medium">Tier {profile.data.tier}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Daily limit</dt>
                <dd className="font-medium">{profile.data.daily_limit}</dd>
              </div>
            </dl>

            <form onSubmit={handleSubmit} className="space-y-2" noValidate>
              <Label htmlFor="account-tag">{currentTag ? "Change your tag" : "Choose a tag"}</Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground" aria-hidden="true">
                  @
                </span>
                <Input
                  id="account-tag"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setServerError(null)
                  }}
                  placeholder="alice_92"
                  autoComplete="off"
                  aria-invalid={inlineError !== null || serverError !== null}
                  aria-describedby="account-tag-help"
                />
              </div>
              <p
                id="account-tag-help"
                role={inlineError || serverError ? "alert" : undefined}
                className={
                  inlineError || serverError
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {serverError ?? inlineError ?? "3 to 20 letters, numbers or underscores."}
              </p>
              <Button type="submit" disabled={!canSave}>
                {saveTag.isPending ? "Saving…" : "Save tag"}
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  )
}
