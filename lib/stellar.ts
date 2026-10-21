/**
 * Stellar network settings and read-only Horizon calls.
 *
 * No SDK here, only fetch, so pages that show balances do not load the
 * transaction builder. Building and signing live in lib/stellar-tx.ts.
 */

export type StellarNetworkName = "testnet" | "mainnet"

export interface StellarNetworkConfig {
  name: StellarNetworkName
  label: string
  passphrase: string
  horizonUrl: string
  /** Circle's USDC issuer. A token called USDC from any other account is not USDC. */
  usdcIssuer: string
  explorerUrl: string
}

const NETWORKS: Record<StellarNetworkName, StellarNetworkConfig> = {
  testnet: {
    name: "testnet",
    label: "Stellar Testnet",
    passphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    explorerUrl: "https://stellar.expert/explorer/testnet",
  },
  mainnet: {
    name: "mainnet",
    label: "Stellar",
    passphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    explorerUrl: "https://stellar.expert/explorer/public",
  },
}

/** Testnet during development, Stellar mainnet in production, like Base. */
const selected = NETWORKS[process.env.NEXT_PUBLIC_CHAIN_ENV === "mainnet" ? "mainnet" : "testnet"]

export const stellarNetwork: StellarNetworkConfig = {
  ...selected,
  horizonUrl: (process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL || selected.horizonUrl).replace(/\/$/, ""),
}

export type StellarAssetCode = "XLM" | "USDC"

export interface StellarBalances {
  /** False until the account has received its first 1 XLM. */
  funded: boolean
  xlm: string
  /**
   * XLM that can actually be sent. Stellar locks a minimum balance per account
   * and per trustline or offer, and a payment that dips into it fails.
   */
  xlmSpendable: string
  /** Null when the account has no USDC trustline, so it cannot hold USDC yet. */
  usdc: string | null
}

const STROOPS_PER_UNIT = 10_000_000n
const BASE_RESERVE_STROOPS = 5_000_000n // 0.5 XLM

/** "12.3400000" to stroops, exactly. Horizon always sends seven decimals. */
export function toStroops(amount: string): bigint {
  const [whole, fraction = ""] = amount.trim().split(".")
  if (!/^\d+$/.test(whole) || !/^\d{0,7}$/.test(fraction)) {
    throw new Error(`not a Stellar amount: ${amount}`)
  }
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(7, "0"))
}

/** Stroops to a human amount with trailing zeros removed. */
export function fromStroops(stroops: bigint): string {
  const negative = stroops < 0n
  const value = negative ? -stroops : stroops
  const whole = value / STROOPS_PER_UNIT
  const fraction = (value % STROOPS_PER_UNIT).toString().padStart(7, "0").replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`
}

interface HorizonBalance {
  asset_type: string
  asset_code?: string
  asset_issuer?: string
  balance: string
  selling_liabilities?: string
}

interface HorizonAccount {
  subentry_count: number
  num_sponsoring?: number
  num_sponsored?: number
  balances: HorizonBalance[]
}

/** Works out balances from a Horizon account record. Exported for tests. */
export function balancesFromAccount(
  account: HorizonAccount,
  usdcIssuer: string = stellarNetwork.usdcIssuer
): StellarBalances {
  const native = account.balances.find((balance) => balance.asset_type === "native")
  const usdc = account.balances.find(
    (balance) =>
      balance.asset_type === "credit_alphanum4" &&
      balance.asset_code === "USDC" &&
      balance.asset_issuer === usdcIssuer
  )

  const xlm = native ? toStroops(native.balance) : 0n
  const entries =
    2n +
    BigInt(account.subentry_count) +
    BigInt(account.num_sponsoring ?? 0) -
    BigInt(account.num_sponsored ?? 0)
  const locked =
    entries * BASE_RESERVE_STROOPS + (native?.selling_liabilities ? toStroops(native.selling_liabilities) : 0n)
  const spendable = xlm > locked ? xlm - locked : 0n

  return {
    funded: true,
    xlm: fromStroops(xlm),
    xlmSpendable: fromStroops(spendable),
    usdc: usdc ? fromStroops(toStroops(usdc.balance)) : null,
  }
}

async function horizon<T>(path: string): Promise<T | null> {
  const response = await fetch(`${stellarNetwork.horizonUrl}${path}`, {
    headers: { Accept: "application/json" },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Horizon returned ${response.status}`)
  return (await response.json()) as T
}

/** Balances for an account, or an unfunded result if it does not exist yet. */
export async function fetchStellarBalances(account: string): Promise<StellarBalances> {
  const record = await horizon<HorizonAccount>(`/accounts/${encodeURIComponent(account)}`)
  if (!record) return { funded: false, xlm: "0", xlmSpendable: "0", usdc: null }
  return balancesFromAccount(record)
}

export async function fetchStellarAccount(account: string): Promise<HorizonAccount & { sequence: string } | null> {
  return horizon(`/accounts/${encodeURIComponent(account)}`)
}

/** A fee per operation that keeps up with the network, within sane bounds. */
export async function fetchStellarFee(): Promise<string> {
  try {
    const stats = await horizon<{ fee_charged: { p70: string } }>("/fee_stats")
    const suggested = Number(stats?.fee_charged.p70 ?? 100)
    return String(Math.min(Math.max(Number.isFinite(suggested) ? suggested : 100, 100), 10_000))
  } catch {
    return "100"
  }
}

/** Plain-language messages for the result codes people actually hit. */
const RESULT_MESSAGES: Record<string, string> = {
  op_underfunded: "Not enough balance for this payment and its fee.",
  op_low_reserve: "This would take the account below the XLM Stellar requires it to keep.",
  op_no_destination: "The recipient's Stellar account does not exist yet.",
  op_no_trust: "The recipient cannot receive this asset yet. They need to add it to their wallet first.",
  op_not_authorized: "The recipient is not authorised to hold this asset.",
  op_line_full: "The recipient cannot hold that much of this asset.",
  op_already_exists: "That account already exists.",
  tx_bad_seq: "Your wallet's transaction count changed. Try again.",
  tx_insufficient_fee: "The network is busy. Try again in a moment.",
  tx_too_late: "The payment took too long to sign. Try again.",
  tx_insufficient_balance: "Not enough XLM to pay the network fee.",
}

export function describeResultCodes(codes: { transaction?: string; operations?: string[] } | undefined): string {
  for (const code of [...(codes?.operations ?? []), codes?.transaction]) {
    if (code && RESULT_MESSAGES[code]) return RESULT_MESSAGES[code]
  }
  return "The Stellar network rejected the payment."
}

/** Submits a signed transaction. Resolves once it is in a closed ledger. */
export async function submitStellarTransaction(signedXdr: string): Promise<string> {
  const response = await fetch(`${stellarNetwork.horizonUrl}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ tx: signedXdr }).toString(),
  })
  const body = await response.json().catch(() => null)
  if (response.ok && body?.hash) return body.hash as string
  throw new Error(describeResultCodes(body?.extras?.result_codes))
}

export function stellarTransactionUrl(hash: string): string {
  return `${stellarNetwork.explorerUrl}/tx/${hash}`
}

/** One hop of a path payment: an asset to convert through. */
export interface StellarPathAsset {
  code: StellarAssetCode
  issuer?: string
}

/** A quoted path payment. Amounts are human units, not stroops. */
export interface StellarPathQuote {
  /** Assets the payment converts through, in order. Empty for a direct payment. */
  path: StellarPathAsset[]
  /** What the sender gives up, including the source asset. */
  sourceAmount: string
  sourceAsset: StellarPathAsset
  /** What the recipient gets, in the destination asset. */
  destinationAmount: string
  destinationAsset: StellarPathAsset
}

export type StellarPathMode = "strict-send" | "strict-receive"

interface HorizonPathRecord {
  source_asset_type: string
  source_asset_code?: string
  source_asset_issuer?: string
  source_amount: string
  destination_asset_type: string
  destination_asset_code?: string
  destination_asset_issuer?: string
  destination_amount: string
  path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>
}

function assetFromHorizon(record: {
  asset_type: string
  asset_code?: string
  asset_issuer?: string
}): StellarPathAsset {
  if (record.asset_type === "native") return { code: "XLM" }
  return { code: record.asset_code as StellarAssetCode, issuer: record.asset_issuer }
}

function assetToHorizonParams(asset: StellarPathAsset, prefix: "source" | "destination"): URLSearchParams {
  const params = new URLSearchParams()
  if (asset.code === "XLM") {
    params.set(`${prefix}_asset_type`, "native")
  } else {
    if (!asset.issuer) throw new Error(`${asset.code} needs an issuer`)
    params.set(`${prefix}_asset_type`, "credit_alphanum4")
    params.set(`${prefix}_asset_code`, asset.code)
    params.set(`${prefix}_asset_issuer`, asset.issuer)
  }
  return params
}

/**
 * Asks Horizon for the best path between two assets.
 *
 * Strict-send fixes what the sender pays and quotes what arrives; strict-receive
 * fixes what the recipient gets and quotes what it costs. Returns null when no
 * path exists, which is a normal answer, not an error.
 */
export async function findStellarPath(options: {
  mode: StellarPathMode
  sourceAsset: StellarPathAsset
  destinationAsset: StellarPathAsset
  /** Amount in the asset the mode fixes: source for strict-send, destination for strict-receive. */
  amount: string
}): Promise<StellarPathQuote | null> {
  const { mode, sourceAsset, destinationAsset, amount } = options
  const params = assetToHorizonParams(sourceAsset, "source")
  for (const [key, value] of assetToHorizonParams(destinationAsset, "destination")) {
    params.set(key, value)
  }
  params.set(mode === "strict-send" ? "source_amount" : "destination_amount", amount)

  const records = await horizon<{ records: HorizonPathRecord[] }>(`/paths/${mode}?${params.toString()}`)
  const best = records?.records?.[0]
  if (!best) return null

  return {
    path: best.path.map(assetFromHorizon),
    sourceAmount: fromStroops(toStroops(best.source_amount)),
    sourceAsset: assetFromHorizon({
      asset_type: best.source_asset_type,
      asset_code: best.source_asset_code,
      asset_issuer: best.source_asset_issuer,
    }),
    destinationAmount: fromStroops(toStroops(best.destination_amount)),
    destinationAsset: assetFromHorizon({
      asset_type: best.destination_asset_type,
      asset_code: best.destination_asset_code,
      asset_issuer: best.destination_asset_issuer,
    }),
  }
}

export interface SlippageCheck {
  ok: boolean
  /** How much worse than the quote the payment is, in basis points. */
  slippageBps: number
  /** The worst amount still acceptable, in the asset the user cares about. */
  minimumReceived?: string
  maximumSent?: string
}

/**
 * Compares a fresh quote against the one the user agreed to.
 *
 * For strict-send the recipient must still get at least `expectedAmount` minus
 * the tolerance; for strict-receive the sender must not pay more than
 * `expectedAmount` plus the tolerance. `toleranceBps` is the slippage limit the
 * user agreed to, in basis points (100 = 1%).
 */
export function checkSlippage(options: {
  mode: StellarPathMode
  expectedAmount: string
  quotedAmount: string
  toleranceBps: number
}): SlippageCheck {
  const { mode, expectedAmount, quotedAmount, toleranceBps } = options
  if (!Number.isFinite(toleranceBps) || toleranceBps < 0) {
    throw new Error(`not a slippage tolerance: ${toleranceBps}`)
  }

  const expected = toStroops(expectedAmount)
  const quoted = toStroops(quotedAmount)
  const tolerance = BigInt(Math.round(toleranceBps))

  if (mode === "strict-send") {
    // Quoted destination below the agreed floor is too much slippage.
    const floor = (expected * (10_000n - tolerance)) / 10_000n
    const ok = quoted >= floor
    const slippageBps = expected > 0n && quoted < expected ? Number(((expected - quoted) * 10_000n) / expected) : 0
    return { ok, slippageBps, minimumReceived: fromStroops(floor) }
  }

  // Strict-receive: quoted source above the agreed ceiling is too much slippage.
  const ceiling = (expected * (10_000n + tolerance)) / 10_000n
  const ok = quoted <= ceiling
  const slippageBps = expected > 0n && quoted > expected ? Number(((quoted - expected) * 10_000n) / expected) : 0
  return { ok, slippageBps, maximumSent: fromStroops(ceiling) }
}
