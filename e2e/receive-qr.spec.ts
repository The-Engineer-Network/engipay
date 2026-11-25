import { expect, test } from "@playwright/test"

/**
 * SEP-7 receive QR end-to-end test.
 *
 * Mocks a connected Stellar (Freighter) wallet and verifies that the Receive
 * page renders a QR code whose web+stellar:pay URI carries the connected
 * address and the requested amount. The "Copy link" control copies that exact
 * URI, so reading the clipboard asserts what the QR encodes without needing a
 * real wallet or camera.
 */

/** A known-valid Stellar public key (G…) used as the connected account. */
const MOCK_ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
const TEST_AMOUNT = "50.00"

/**
 * Injects a fake Freighter extension into the page. The real freighter-api
 * library talks to the extension through window.postMessage; answering those
 * messages makes StellarWalletProvider restore a connected Stellar account on
 * load (combined with the persisted "engipay-stellar-connected" flag).
 */
async function mockConnectedStellarWallet(
  page: import("@playwright/test").Page,
  address: string
) {
  await page.addInitScript((mockAddress) => {
    // `window.freighter` short-circuits the library's isConnected() check.
    ;(window as unknown as { freighter: boolean }).freighter = true
    localStorage.setItem("engipay-stellar-connected", "true")

    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return
      const data = event.data
      if (!data || data.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return

      let response: Record<string, unknown> = {}
      switch (data.type) {
        case "REQUEST_CONNECTION_STATUS":
          response = { isConnected: true }
          break
        case "REQUEST_PUBLIC_KEY":
          response = { publicKey: mockAddress }
          break
        case "REQUEST_NETWORK_DETAILS":
          // Must match the app's configured Stellar network so no
          // "network mismatch" warning blocks the receive UI.
          response = {
            networkDetails: {
              network: "testnet",
              networkName: "Testnet",
              networkUrl: "https://horizon-testnet.stellar.org",
              networkPassphrase: "Test SDF Network ; September 2015",
            },
          }
          break
      }

      window.postMessage(
        {
          source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
          // The library matches responses with this (misspelled) correlation id.
          messagedId: data.messageId,
          ...response,
        },
        window.location.origin
      )
    })
  }, address)
}

test("receive renders a SEP-7 code with the connected Stellar address and amount", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await mockConnectedStellarWallet(page, MOCK_ADDRESS)

  await page.goto("/receive")

  // With a Stellar wallet connected and no EVM wallet, the Receive page
  // defaults to the Stellar network.
  const stellarTab = page.getByRole("tab", { name: /Stellar/i })
  await expect(stellarTab).toHaveAttribute("aria-selected", "true")

  // Enter an amount so the URI includes it.
  await page.getByLabel("Amount (optional)").fill(TEST_AMOUNT)

  // The QR code is rendered from the same payment URI we assert below.
  const qrCode = page.getByAltText("Receive QR code")
  await expect(qrCode).toBeVisible()

  // "Copy link" copies the exact URI encoded in the QR code.
  await page.getByRole("button", { name: /Copy link/i }).click()

  const uri = await page.evaluate(() => navigator.clipboard.readText())

  expect(uri, "payment URI scheme").toMatch(/^web\+stellar:pay\?/)
  expect(uri, "destination in QR URI").toContain(`destination=${MOCK_ADDRESS}`)
  expect(uri, "amount in QR URI").toContain(`amount=${TEST_AMOUNT}`)
})