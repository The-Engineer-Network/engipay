import { expect, test, type ConsoleMessage, type Page } from "@playwright/test"

/** Public marketing routes that must load cleanly in the browser. */
const MARKETING_ROUTES = ["/", "/about", "/faq", "/features", "/help", "/privacy", "/technology"]

/**
 * The root layout mounts wallet and analytics providers that call third-party
 * services. With no WalletConnect project id configured (and on a self-hosted
 * build), those services reject the local origin and log their own errors.
 * They say nothing about the marketing pages, so ignore just those requests
 * and keep failing on every other console error.
 */
function isThirdPartyNoise(message: ConsoleMessage): boolean {
  const url = message.location().url
  return (
    url.startsWith("https://pulse.walletconnect.org/") ||
    url.startsWith("https://api.web3modal.org/") ||
    url.endsWith("/_vercel/insights/script.js") ||
    message.text().includes("not found on Allowlist - update configuration on cloud.reown.com")
  )
}

/** Collect errors reported to the console while a page loads and hydrates. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error" && !isThirdPartyNoise(message)) {
      errors.push(`${message.text()} (${message.location().url})`)
    }
  })
  page.on("pageerror", (error) => errors.push(`Uncaught exception: ${error.message}`))
  return errors
}

for (const route of MARKETING_ROUTES) {
  test(`${route} loads without console errors`, async ({ page }) => {
    const errors = collectConsoleErrors(page)

    await page.goto(route)
    await expect(page.locator("main")).toBeVisible()

    // The theme toggle renders only after hydration. Waiting for it means
    // errors from the client-side render have been reported by now.
    await expect(page.getByRole("button", { name: /Switch to (light|dark) mode/ })).toBeVisible()

    expect(errors, `console errors on ${route}`).toEqual([])
  })
}
