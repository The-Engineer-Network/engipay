/**
 * Building Stellar payments, with the Stellar Development Foundation's
 * @stellar/stellar-base. Loaded only when someone sends, so the rest of the app
 * does not carry the transaction builder.
 */

import {
  Account,
  Asset,
  Memo,
  MuxedAccount,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-base"
import type { StellarMemo } from "@/lib/payment-uri"
import { STELLAR_AMOUNT, isStellarAddress, isStellarSecretKey } from "@/lib/payment-uri"
import {
  type StellarAssetCode,
  balancesFromAccount,
  fetchStellarAccount,
  fetchStellarFee,
  stellarNetwork,
  toStroops,
} from "@/lib/stellar"

export interface StellarPaymentInput {
  source: string
  destination: string
  amount: string
  asset: StellarAssetCode
  memo?: StellarMemo
}

export interface BuiltPayment {
  xdr: string
  /** True when the recipient had no account, so this payment creates it. */
  createsAccount: boolean
}

/** Stellar's minimum to open a new account. */
const MIN_NEW_ACCOUNT_STROOPS = 10_000_000n

/**
 * Checks everything that can be checked before the wallet is asked to sign,
 * so people see a clear reason instead of a network error after signing.
 */
export async function buildStellarPayment(input: StellarPaymentInput): Promise<BuiltPayment> {
  const destination = input.destination.trim()
  if (isStellarSecretKey(destination)) {
    throw new Error(
      "That is a Stellar secret key, not an address. Never share it: move any funds on it to a new account."
    )
  }
  if (!isStellarAddress(destination)) throw new Error("That is not a valid Stellar address.")
  if (!STELLAR_AMOUNT.test(input.amount) || toStroops(input.amount) <= 0n) {
    throw new Error("Enter an amount greater than zero, with at most 7 decimal places.")
  }
  const amount = toStroops(input.amount)

  // A muxed address (M…) pays into its base account (G…).
  const baseDestination = destination.startsWith("M")
    ? MuxedAccount.fromAddress(destination, "0").baseAccount().accountId()
    : destination
  if (baseDestination === input.source) throw new Error("You cannot pay your own account.")

  const [source, recipient, fee] = await Promise.all([
    fetchStellarAccount(input.source),
    fetchStellarAccount(baseDestination),
    fetchStellarFee(),
  ])
  if (!source) {
    throw new Error("Your Stellar account is not active yet. It needs at least 1 XLM sent to it first.")
  }

  const held = balancesFromAccount(source)
  if (input.asset === "XLM" && amount > toStroops(held.xlmSpendable)) {
    throw new Error(`You can send at most ${held.xlmSpendable} XLM. Stellar keeps the rest as your account reserve.`)
  }
  if (input.asset === "USDC" && (held.usdc === null || amount > toStroops(held.usdc))) {
    throw new Error(`Not enough USDC. You have ${held.usdc ?? "0"}.`)
  }

  let operation
  let createsAccount = false
  if (!recipient) {
    if (input.asset !== "XLM") {
      throw new Error("The recipient's Stellar account does not exist yet, so it cannot receive USDC.")
    }
    if (destination.startsWith("M")) {
      throw new Error("That muxed address belongs to an account that does not exist yet.")
    }
    if (amount < MIN_NEW_ACCOUNT_STROOPS) {
      throw new Error("This account is new on Stellar. The first payment to it must be at least 1 XLM.")
    }
    operation = Operation.createAccount({ destination, startingBalance: input.amount })
    createsAccount = true
  } else {
    if (input.asset === "USDC" && balancesFromAccount(recipient).usdc === null) {
      throw new Error("The recipient cannot receive USDC yet. They need to add USDC to their Stellar wallet first.")
    }
    operation = Operation.payment({
      destination,
      asset:
        input.asset === "XLM" ? Asset.native() : new Asset("USDC", stellarNetwork.usdcIssuer),
      amount: input.amount,
    })
  }

  const builder = new TransactionBuilder(new Account(input.source, source.sequence), {
    fee,
    networkPassphrase: stellarNetwork.passphrase,
  })
    .addOperation(operation)
    // Unsigned or unsubmitted payments expire instead of landing much later.
    .setTimeout(180)

  if (input.memo) {
    builder.addMemo(input.memo.type === "id" ? Memo.id(input.memo.value) : Memo.text(input.memo.value))
  }

  return { xdr: builder.build().toXDR(), createsAccount }
}
