"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import QRCode from "qrcode"
import { useConnect, type Connector } from "wagmi"
import {
  ArrowLeft,
  ChevronRight,
  CircleHelp,
  Download,
  Loader2,
  Search,
  X,
} from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

/** The parts of RainbowKit's per-wallet metadata this sheet reads. */
interface RkDetails {
  id: string
  name: string
  iconUrl: string | (() => Promise<string>)
  iconBackground: string
  installed?: boolean
  groupIndex: number
  index: number
  downloadUrls?: Partial<Record<string, string>>
  mobile?: { getUri?: (uri: string) => string }
  qrCode?: { getUri: (uri: string) => string }
  isWalletConnectModalConnector?: boolean
}

type RkConnector = Connector & { rkDetails?: RkDetails }

interface WalletOption {
  key: string
  name: string
  iconBackground: string
  iconUrl: RkDetails["iconUrl"] | undefined
  installed: boolean
  connector: RkConnector
  rk?: RkDetails
  rank: number
}

type View =
  | { kind: "list" }
  | { kind: "connecting"; option: WalletOption }
  | { kind: "qr"; option: WalletOption; uri: string | null }
  | { kind: "get"; option: WalletOption }
  | { kind: "error"; option: WalletOption; message: string }

/** How many wallets show before "Search wallet" takes over. */
const PREVIEW_COUNT = 6

const hasWalletConnectId = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID)

interface WalletSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called once a wallet has connected. */
  onConnected?: () => void
}

/**
 * The wallet picker. A bottom sheet on phones and a small dialog on desktop:
 * wallets the browser already has come first and are marked, the rest are one
 * search away. Replaces RainbowKit's modal, whose layout cannot be changed
 * beyond colours.
 */
export function WalletSheet({ open, onOpenChange, onConnected }: WalletSheetProps) {
  const isMobile = useIsMobile()
  const body = (
    <WalletPicker onConnected={() => {
      onOpenChange(false)
      onConnected?.()
    }} onClose={() => onOpenChange(false)} isMobile={isMobile} />
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[88vh] border-border bg-card">
          <DrawerTitle className="sr-only">Connect wallet</DrawerTitle>
          {open && body}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[400px] gap-0 overflow-hidden rounded-3xl border-border bg-card p-0 [&>button:last-child]:hidden"
      >
        <DialogTitle className="sr-only">Connect wallet</DialogTitle>
        {open && body}
      </DialogContent>
    </Dialog>
  )
}

function WalletPicker({
  onConnected,
  onClose,
  isMobile,
}: {
  onConnected: () => void
  onClose: () => void
  isMobile: boolean
}) {
  const { connectors, connectAsync } = useConnect()
  const [view, setView] = useState<View>({ kind: "list" })
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [icons, setIcons] = useState<Record<string, string>>({})
  const searchRef = useRef<HTMLInputElement>(null)

  const options = useMemo<WalletOption[]>(() => {
    const byName = new Map<string, WalletOption>()

    for (const raw of connectors as readonly RkConnector[]) {
      const rk = raw.rkDetails
      // RainbowKit adds a hidden duplicate for its own WalletConnect modal.
      if (rk?.isWalletConnectModalConnector) continue

      const name = rk?.name ?? raw.name
      const installed = Boolean(rk?.installed) || (raw.type === "injected" && Boolean(raw.icon))
      const option: WalletOption = {
        key: raw.uid,
        name,
        iconBackground: rk?.iconBackground ?? "transparent",
        iconUrl: raw.icon ?? rk?.iconUrl,
        installed,
        connector: raw,
        rk,
        rank: rk ? rk.groupIndex * 100 + rk.index : 10_000,
      }

      // The same wallet can arrive twice: discovered in the browser, and from
      // our list. Keep one row, preferring the one that is actually installed.
      const key = name.toLowerCase()
      const existing = byName.get(key)
      if (!existing || (option.installed && !existing.installed)) byName.set(key, option)
    }

    return [...byName.values()].sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1
      return a.rank - b.rank
    })
  }, [connectors])

  // Some wallet icons are loaded lazily; resolve them once.
  useEffect(() => {
    let cancelled = false
    for (const option of options) {
      const src = option.iconUrl
      if (!src || icons[option.key]) continue
      if (typeof src === "string") {
        setIcons((current) => ({ ...current, [option.key]: src }))
      } else {
        src()
          .then((url) => {
            if (!cancelled) setIcons((current) => ({ ...current, [option.key]: url }))
          })
          .catch(() => {})
      }
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options])

  useEffect(() => {
    if (searching) searchRef.current?.focus()
  }, [searching])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((option) => option.name.toLowerCase().includes(q)) : options
  }, [options, query])

  const visible = searching ? filtered : options.slice(0, PREVIEW_COUNT)

  const choose = async (option: WalletOption) => {
    const { connector, rk } = option
    const usesWalletConnect = Boolean(rk?.qrCode?.getUri || rk?.mobile?.getUri) || connector.type === "walletConnect"

    if (!option.installed && !usesWalletConnect) {
      setView({ kind: "get", option })
      return
    }

    if (!option.installed && usesWalletConnect && !hasWalletConnectId) {
      setView({
        kind: "error",
        option,
        message:
          "Connecting this wallet needs WalletConnect, which is not set up on this site yet. Wallets installed in your browser still work.",
      })
      return
    }

    const onMessage = ({ type, data }: { type: string; data?: unknown }) => {
      if (type !== "display_uri" || typeof data !== "string") return
      if (isMobile && rk?.mobile?.getUri) {
        // On a phone, hand straight over to the wallet app.
        window.location.href = rk.mobile.getUri(data)
        return
      }
      setView({ kind: "qr", option, uri: rk?.qrCode?.getUri ? rk.qrCode.getUri(data) : data })
    }

    connector.emitter.on("message", onMessage)
    setView(
      !option.installed && !isMobile ? { kind: "qr", option, uri: null } : { kind: "connecting", option }
    )

    try {
      await connectAsync({ connector })
      onConnected()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/reject|denied|cancel/i.test(message)) {
        setView({ kind: "list" })
      } else {
        setView({ kind: "error", option, message: "The wallet could not connect. Try again." })
      }
    } finally {
      connector.emitter.off("message", onMessage)
    }
  }

  const back = () => setView({ kind: "list" })

  return (
    <div className="flex max-h-[80vh] flex-col">
      {/* Header: help, title, close - the same three things in every view. */}
      <div className="flex items-center justify-between px-5 pb-3 pt-5">
        {view.kind === "list" && !searching ? (
          <Link
            href="/help#connect"
            onClick={onClose}
            aria-label="Help with connecting a wallet"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <CircleHelp className="h-5 w-5" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (view.kind !== "list") back()
              else {
                setSearching(false)
                setQuery("")
              }
            }}
            aria-label="Back"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}

        <p className="text-base font-semibold">
          {view.kind === "list" ? "Connect wallet" : view.option.name}
        </p>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {view.kind === "list" && (
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-5">
          {searching && (
            <div className="relative mx-2 mb-3">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search wallet"
                aria-label="Search wallets"
                className="h-11 w-full rounded-xl border border-border bg-background/60 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
              />
            </div>
          )}

          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((option) => (
              <li key={option.key}>
                <button
                  type="button"
                  onClick={() => choose(option)}
                  className="group flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <WalletIcon src={icons[option.key]} background={option.iconBackground} name={option.name} />
                  <span className="flex-1 truncate text-[15px] font-medium">{option.name}</span>
                  {option.installed && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                      Detected
                    </span>
                  )}
                  <ChevronRight
                    className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}

            {searching && filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No wallet called “{query}”. Most wallets connect through WalletConnect.
              </li>
            )}
          </ul>

          {!searching && options.length > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setSearching(true)}
              className="mx-1 mt-2 flex items-center gap-3.5 rounded-xl bg-accent/60 px-3 py-3 text-left transition-colors hover:bg-accent"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </span>
              <span className="flex-1 text-[15px] font-medium">Search wallet</span>
              <span className="rounded-md bg-background/70 px-2 py-0.5 text-xs text-muted-foreground">
                {options.length}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {view.kind === "connecting" && (
        <StatusPanel
          icon={icons[view.option.key]}
          background={view.option.iconBackground}
          name={view.option.name}
          title={`Opening ${view.option.name}`}
          body="Approve the connection in your wallet to continue."
          busy
        />
      )}

      {view.kind === "qr" && <QrPanel option={view.option} uri={view.uri} />}

      {view.kind === "get" && (
        <StatusPanel
          icon={icons[view.option.key]}
          background={view.option.iconBackground}
          name={view.option.name}
          title={`${view.option.name} is not installed`}
          body="Install it, then come back and connect. Or pick a wallet you already have."
        >
          {(() => {
            const urls = view.option.rk?.downloadUrls
            const href = urls?.browserExtension ?? urls?.chrome ?? urls?.desktop ?? urls?.mobile
            return href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Get {view.option.name}
              </a>
            ) : null
          })()}
        </StatusPanel>
      )}

      {view.kind === "error" && (
        <StatusPanel
          icon={icons[view.option.key]}
          background={view.option.iconBackground}
          name={view.option.name}
          title="Could not connect"
          body={view.message}
        >
          <button
            type="button"
            onClick={back}
            className="mt-5 rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent"
          >
            Choose another wallet
          </button>
        </StatusPanel>
      )}
    </div>
  )
}

function WalletIcon({ src, background, name }: { src?: string; background: string; name: string }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1 ring-border"
      style={{ background }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-sm font-semibold text-muted-foreground">{name.slice(0, 1)}</span>
      )}
    </span>
  )
}

function StatusPanel({
  icon,
  background,
  name,
  title,
  body,
  busy,
  children,
}: {
  icon?: string
  background: string
  name: string
  title: string
  body: string
  busy?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-8 pb-10 pt-6 text-center">
      <div className="relative mb-5">
        <span className={cn("block", busy && "pulse-ring rounded-2xl")}>
          <span
            className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl ring-1 ring-border"
            style={{ background }}
          >
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl font-semibold">{name.slice(0, 1)}</span>
            )}
          </span>
        </span>
      </div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">{body}</p>
      {busy && <Loader2 className="mt-5 h-5 w-5 animate-spin text-primary" aria-hidden="true" />}
      {children}
    </div>
  )
}

function QrPanel({ option, uri }: { option: WalletOption; uri: string | null }) {
  const [dataUrl, setDataUrl] = useState("")

  useEffect(() => {
    if (!uri) return
    let cancelled = false
    QRCode.toDataURL(uri, { margin: 1, width: 280 })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [uri])

  return (
    <div className="flex flex-col items-center px-8 pb-10 pt-4 text-center">
      <div className="mb-5 flex h-[280px] w-[280px] items-center justify-center rounded-2xl bg-white p-3">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt={`QR code to connect ${option.name}`} className="h-full w-full" />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" aria-hidden="true" />
        )}
      </div>
      <p className="font-semibold">Scan with {option.name}</p>
      <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
        Open {option.name} on your phone, tap scan, and point it at this code.
      </p>
    </div>
  )
}
