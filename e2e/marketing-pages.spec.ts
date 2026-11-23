import { expect, test, type Page } from "@playwright/test"

/** Marketing pages that must load without console errors. */
const MARKETING_PAGES = ["/", "/about", "/faq", "/features", "/help", "/privacy", "/technology"]

/**
 * Collects console errors for a page. A page that logs an error to the
 * console — a hydration failure, a broken provider, a failed resource —
 * fails the test even when the HTTP status is 200.
 */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() !== "error") return

    const text = message.text()
    const url = message.location().url
    // Vercel Analytics and WalletConnect/Reown are not configured outside
    // production, so they log failed requests and an origin allowlist error.
    // They are not problems with the pages themselves.
    if (
      url.includes("/_vercel/insights/") ||
      text.includes("_vercel/insights/script.js") ||
      url.includes("api.web3modal.org") ||
      url.includes("pulse.walletconnect.org") ||
      (text.includes("not found on Allowlist") && text.includes("cloud.reown.com"))
    ) {
      return
    }
    errors.push(`${text} (${url})`)
  })
  return errors
}

for (const path of MARKETING_PAGES) {
  test(`marketing page ${path} loads without console errors`, async ({ page }) => {
    const errors = trackConsoleErrors(page)

    const response = await page.goto(path)
    expect(response?.status(), `HTTP status for ${path}`).toBeLessThan(400)

    // Let hydration settle, but do not wait indefinitely on third-party
    // requests that are blocked outside production.
    await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {})

    expect(errors, `console errors on ${path}`).toEqual([])
  })
}
