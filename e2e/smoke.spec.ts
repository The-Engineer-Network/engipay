import { expect, test, type Page } from "@playwright/test"

/** Public pages that must render without throwing. */
const PUBLIC_PAGES = ["/", "/features", "/technology", "/help", "/privacy", "/about", "/faq"]

/**
 * Collects uncaught exceptions for a page. A page that throws during render
 * or hydration fails the test even when the HTTP status is 200.
 */
function trackPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

for (const path of PUBLIC_PAGES) {
  test(`public page ${path} renders without throwing`, async ({ page }) => {
    const errors = trackPageErrors(page)

    const response = await page.goto(path)
    expect(response?.status(), `HTTP status for ${path}`).toBeLessThan(400)

    await expect(page.locator("main")).toBeVisible()
    expect(errors, `uncaught errors on ${path}`).toEqual([])
  })
}

test("dashboard asks a signed-out visitor to connect a wallet", async ({ page }) => {
  const errors = trackPageErrors(page)

  await page.goto("/dashboard")

  await expect(page.getByRole("heading", { name: "Connect your wallet" })).toBeVisible()
  expect(errors, "uncaught errors on /dashboard").toEqual([])
})
