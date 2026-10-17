# Issue #438: Connect the Sell screen to live quotes and orders

Status: **blocked on backend work.** Not implemented yet.

## What the screen does today

`app/(app)/sell/page.tsx` has the amount input, asset picker, and a "Paid into" bank account button. Rate, fee and "You receive" show `—`, Continue is disabled, and a note says the Naira payout partner, bank account and identity check are not connected.

## What the issue needs

1. Fetch and display a quote for the chosen asset and amount.
2. Let the user pick a saved bank account or add one.
3. Create the order, then show its status until the payout completes or fails.
4. The amount cannot exceed the available EngiPay balance.
5. A failed payout tells the user their funds were returned.

## What is missing

- **Quote endpoint:** rate, fee, amount received, and an expiry. The backend has no quote route for Naira conversion. The chain service only quotes network fees (`backend/crates/chain/src/routes/estimate_fee.rs`).
- **Bank account endpoints:** list, add and verify a Nigerian bank account. None exist.
- **Order endpoint and order status:** none exist. The API routes are `/transactions`, `/transfers`, `/withdrawals` and `/payment-requests`, and none of them cover Naira payouts.
- **Payout partner:** the page itself says the partner, identity check and bank account are not connected yet. The privacy policy names a licensed partner that is still to be connected.
- **Refund on failed payout:** depends on the order and ledger work above.

## What would unblock it

A maintainer confirms the payout partner and the endpoint contracts for quote, bank accounts, order and order status. Then the screen can be wired to them, including the refund message for failed payouts.

## Notes

This file records the blocker only. It does not close the issue.
