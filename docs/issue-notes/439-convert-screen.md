# Issue #439: Connect the Convert screen to live quotes

Status: **blocked on backend work.** Not implemented yet.

## What the screen does today

`app/(app)/convert/page.tsx` has the "You pay" amount and asset picker, the swap button, and a "You receive" field that is read-only and empty. Rate, fee and "You receive" show `—`, Convert is disabled, and a note says the pricing and swap service is not built yet. The page already guards against choosing the same asset on both sides, with an explanation.

## What the issue needs

1. Fetch a quote for the chosen pair and amount.
2. Show the rate, fee, amount received and a countdown to expiry.
3. Confirm, then show the result and the updated balances.
4. Choosing the same asset on both sides disables Convert with an explanation.
5. An expired quote is refreshed before it can be submitted.

## What is missing

- **Quote endpoint:** rate, fee, amount received and an expiry time. The countdown and the expired-quote refresh depend on that expiry. No such route exists.
- **Swap order endpoint:** submits the confirmed quote and returns the result and updated balances. None exists.
- **Pricing and swap service:** the page says it is not built yet. The repo's scope includes "token swaps" as a feature still being built (`app/(marketing)/faq/page.tsx`).

## What would unblock it

A maintainer confirms the quote and swap endpoint contracts, including what the quote's expiry looks like. Then the screen can be wired to them, including the countdown, expired-quote refresh and same-asset guard, which are already partly in the page.

## Notes

This file records the blocker only. It does not close the issue.
