/**
 * Reading and writing payment codes.
 *
 * EngiPay shows and accepts four shapes, in this order of preference:
 *   1. an EngiPay JSON envelope, which carries a note and a reference
 *   2. EIP-681  (ethereum:0x…@8453)      - understood by every EVM wallet
 *   3. BIP-21   (bitcoin:bc1…?amount=…)  - understood by every BTC wallet
 *   4. a bare address
 *
 * An EngiPay envelope always embeds the standard URI as well, so a code we
 * produce still works in a wallet that has never heard of EngiPay.
 */

export type PaymentChain = "base" | "bitcoin"

export interface ParsedPayment {
  chain: PaymentChain
  /** Where the money goes. */
  address: string
  /** Human amount, e.g. "25.00". Undefined when the code names no amount. */
  amount?: string
  /** Symbol of the requested asset, e.g. "USDC". Undefined means the chain's native coin. */
  asset?: string
  /** ERC-20 contract address, when the request is for a token. */
  tokenAddress?: string
  /** Free-text note carried by EngiPay codes. */
  reference?: string
  /** EVM chain the code names, when it names one. */
  chainId?: number
  /**
   * False when the code is for a network EngiPay does not send on. The code is
   * still returned so the UI can say what it is, rather than "not recognised".
   */
  supportedNetwork: boolean
  /** What was actually scanned. */
  raw: string
}

/** Base mainnet. Kept local so this file has no import cycle with lib/wagmi. */
const BASE_CHAIN_ID = 8453
const BASE_SEPOLIA_CHAIN_ID = 84532

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/
// Legacy (1…, 3…) and bech32 (bc1…) Bitcoin addresses.
const BTC_ADDRESS = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS.test(value.trim())
}

export function isBitcoinAddress(value: string): boolean {
  return BTC_ADDRESS.test(value.trim())
}

/**
 * Converts a base-unit integer string into a human amount.
 * "1500000" with 6 decimals becomes "1.5".
 */
function fromBaseUnits(value: string, decimals: number): string | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const padded = value.padStart(decimals + 1, "0")
  const whole = padded.slice(0, padded.length - decimals)
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole
}

/** Converts a human amount into a base-unit integer string, without floating point. */
export function toBaseUnits(amount: string, decimals: number): string {
  const [whole = "0", fraction = ""] = amount.trim().split(".")
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals)
  return `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "")
}

function parseEngipayEnvelope(raw: string): ParsedPayment | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || data.type !== "engipay.request") return null

  const to = typeof data.to === "string" ? data.to.trim() : ""
  const chain: PaymentChain = data.chain === "bitcoin" ? "bitcoin" : "base"

  // Never trust the recipient in a scanned code: it must be a real address
  // for the chain the code claims.
  const validRecipient = chain === "bitcoin" ? isBitcoinAddress(to) : isEvmAddress(to)
  if (!validRecipient) return null

  return {
    chain,
    address: to,
    supportedNetwork: true,
    amount: typeof data.amount === "string" ? data.amount : undefined,
    asset: typeof data.asset === "string" ? data.asset : undefined,
    reference: typeof data.ref === "string" ? data.ref : undefined,
    raw,
  }
}

/**
 * EIP-681. Two forms matter:
 *   ethereum:0x<to>@8453?value=<wei>
 *   ethereum:0x<token>@8453/transfer?address=0x<to>&uint256=<base units>
 */
function parseEip681(raw: string, tokenDecimals: (token: string) => number | undefined): ParsedPayment | null {
  if (!raw.toLowerCase().startsWith("ethereum:")) return null

  const body = raw.slice("ethereum:".length)
  const [target, query = ""] = body.split("?")
  const [addressPart, functionName] = target.split("/")
  const [address, chainId] = addressPart.split("@")

  if (!isEvmAddress(address)) return null

  const parsedChainId = chainId ? Number(chainId) : undefined
  if (chainId && !Number.isInteger(parsedChainId)) return null
  const supportedNetwork =
    parsedChainId === undefined ||
    parsedChainId === BASE_CHAIN_ID ||
    parsedChainId === BASE_SEPOLIA_CHAIN_ID

  const params = new URLSearchParams(query)

  if (functionName === "transfer") {
    const to = params.get("address") ?? ""
    if (!isEvmAddress(to)) return null
    const decimals = tokenDecimals(address) ?? 18
    const rawAmount = params.get("uint256")
    return {
      chain: "base",
      address: to,
      tokenAddress: address,
      amount: rawAmount ? fromBaseUnits(rawAmount, decimals) : undefined,
      chainId: parsedChainId,
      supportedNetwork,
      raw,
    }
  }

  const value = params.get("value")
  return {
    chain: "base",
    address,
    amount: value ? fromBaseUnits(value, 18) : undefined,
    chainId: parsedChainId,
    supportedNetwork,
    raw,
  }
}

/** BIP-21: bitcoin:<address>?amount=0.0015&label=… */
function parseBip21(raw: string): ParsedPayment | null {
  if (!raw.toLowerCase().startsWith("bitcoin:")) return null

  const body = raw.slice("bitcoin:".length)
  const [address, query = ""] = body.split("?")
  if (!isBitcoinAddress(address)) return null

  const params = new URLSearchParams(query)
  const amount = params.get("amount")
  return {
    chain: "bitcoin",
    address,
    amount: amount ?? undefined,
    asset: "BTC",
    reference: params.get("message") ?? params.get("label") ?? undefined,
    supportedNetwork: true,
    raw,
  }
}

/**
 * Reads any supported payment code.
 * `tokenDecimals` maps an ERC-20 contract address to its decimals, so token
 * amounts come back as human numbers. Returns null when nothing is recognised.
 */
export function parsePaymentCode(
  input: string,
  tokenDecimals: (token: string) => number | undefined = () => undefined
): ParsedPayment | null {
  const raw = input.trim()
  if (!raw) return null

  const envelope = parseEngipayEnvelope(raw)
  if (envelope) return envelope

  const eip681 = parseEip681(raw, tokenDecimals)
  if (eip681) return eip681

  const bip21 = parseBip21(raw)
  if (bip21) return bip21

  if (isEvmAddress(raw)) return { chain: "base", address: raw, supportedNetwork: true, raw }
  if (isBitcoinAddress(raw)) {
    return { chain: "bitcoin", address: raw, asset: "BTC", supportedNetwork: true, raw }
  }

  return null
}

export interface BuildRequestOptions {
  chain: PaymentChain
  address: string
  /** Human amount, e.g. "25.00". Omit for an open request. */
  amount?: string
  /** Symbol shown to the payer. */
  asset?: string
  /** ERC-20 contract, when asking for a token rather than the native coin. */
  tokenAddress?: string
  /** Decimals of that token. */
  tokenDecimals?: number
  chainId?: number
  reference?: string
}

/** Builds the standard URI that any wallet can read. */
export function buildPaymentUri(options: BuildRequestOptions): string {
  const { chain, address, amount, tokenAddress, tokenDecimals = 18, chainId = BASE_CHAIN_ID } = options

  if (chain === "bitcoin") {
    return amount ? `bitcoin:${address}?amount=${amount}` : `bitcoin:${address}`
  }

  if (tokenAddress) {
    const base = `ethereum:${tokenAddress}@${chainId}/transfer?address=${address}`
    return amount ? `${base}&uint256=${toBaseUnits(amount, tokenDecimals)}` : base
  }

  const base = `ethereum:${address}@${chainId}`
  return amount ? `${base}?value=${toBaseUnits(amount, 18)}` : base
}

/**
 * Builds the EngiPay envelope, with the standard URI embedded so outside
 * wallets can still pay it.
 */
export function buildEngipayRequest(options: BuildRequestOptions): string {
  const payload: Record<string, unknown> = {
    v: 1,
    type: "engipay.request",
    chain: options.chain,
    to: options.address,
    uri: buildPaymentUri(options),
  }
  if (options.asset) payload.asset = options.asset
  if (options.amount) payload.amount = options.amount
  if (options.reference) payload.ref = options.reference

  return JSON.stringify(payload)
}

/** Shortens an address for display: 0x1234…abcd */
export function shortenAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}
