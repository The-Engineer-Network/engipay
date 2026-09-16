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

export function stellarAccountUrl(account: string): string {
  return `${stellarNetwork.explorerUrl}/account/${account}`
}
