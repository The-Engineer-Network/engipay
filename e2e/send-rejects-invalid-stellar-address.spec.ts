import { expect, test, type Page } from "@playwright/test"

/**
 * End-to-end test for issue #713: Send rejects an invalid Stellar address.
 *
 * The StellarSendPayment form is only rendered once a Stellar wallet is
 * connected, so we install a minimal Freighter stub before the app loads.
 * Nothing is signed: the invalid inputs are rejected by client-side
 * validation before any wallet interaction would take place.
 */

/** A valid 56-character G… strkey, used only to satisfy the connection check. */
const CONNECTED_ACCOUNT = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57"

/** Pretend the Freighter extension is installed, approved and connected. */
async function connectStellarWallet(page: Page) {
  await page.addInitScript((account) => {
    // freighter-api's isConnected() trusts window.freighter when present.
    Object.defineProperty(window, "freighter", { value: {}, configurable: true })
    localStorage.setItem("engipay-stellar-connected", "true")

    // getAddress() asks the extension for the public key over postMessage.
    const originalPostMessage = window.postMessage.bind(window)
    Object.defineProperty(window, "postMessage", {
      configurable: true,
      value: (message: any, targetOrigin: string) => {
        const request = message as { source?: string; messageId?: number; type?: string }
        if (
          request?.source === "FREIGHTER_EXTERNAL_MSG_REQUEST" &&
          request.type === "REQUEST_PUBLIC_KEY"
        ) {
          window.dispatchEvent(
            new MessageEvent("message", {
              source: window,
              data: {
                source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
                messagedId: request.messageId,
                publicKey: account,
              },
            })
          )
          return
        }
        return originalPostMessage(message, targetOrigin)
      },
    })
  }, CONNECTED_ACCOUNT)
}

/** Open the Send page on its Stellar tab with a connected wallet. */
async function openStellarSend(page: Page) {
  await connectStellarWallet(page)
  await page.goto("/send?network=stellar")
  await expect(page.getByRole("heading", { name: "Send" })).toBeVisible()

  // The Stellar form's recipient input uses the "G..." placeholder.
  await expect(page.getByPlaceholder(/G\.\.\./)).toBeVisible()
}

test("Send rejects an invalid Stellar address", async ({ page }) => {
  await openStellarSend(page)

  const recipient = page.getByPlaceholder(/G\.\.\./)
  await recipient.fill("not-a-stellar-address")

  await expect(page.getByText("That is not a valid Stellar address.")).toBeVisible()
  await expect(recipient).toHaveAttribute("aria-invalid", "true")
})

test("Send rejects a Stellar secret key", async ({ page }) => {
  await openStellarSend(page)

  const recipient = page.getByPlaceholder(/G\.\.\./)
  await recipient.fill("SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X")

  await expect(page.getByText(/That is a Stellar secret key, not an address\./)).toBeVisible()
  await expect(recipient).toHaveAttribute("aria-invalid", "true")
})