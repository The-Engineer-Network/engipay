/** Tests for the Stellar wallet sign-in hook's async flow. */
import { register } from "node:module"
import { after, afterEach, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

// The hook uses the app's "@/" import alias; install the test-only resolver
// before dynamically importing it below.
register("./test-alias-hooks.mjs", import.meta.url)

const ADDRESS = "GABCD123456789012345678901234567890123456789012345678901234"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

type UseStellarSignIn = typeof import("../hooks/use-stellar-sign-in.ts").useStellarSignIn
type SignIn = ReturnType<UseStellarSignIn>["signIn"]

let useStellarSignIn: UseStellarSignIn
const originalFetch = globalThis.fetch
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL

before(async () => {
  process.env.NEXT_PUBLIC_API_URL = "http://test.local"
  ;({ useStellarSignIn } = await import("../hooks/use-stellar-sign-in.ts"))
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

after(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl
})

/** Render the hook once and return its signIn callback for the test. */
function getSignIn(): SignIn {
  let signIn: SignIn | undefined

  function Harness() {
    signIn = useStellarSignIn().signIn
    return React.createElement("span")
  }

  renderToStaticMarkup(React.createElement(Harness))
  assert.ok(signIn)
  return signIn
}

describe("useStellarSignIn", () => {
  it("gets a nonce, signs the message and stores the returned session", async () => {
    const requests: Request[] = []
    globalThis.fetch = async (input, init) => {
      requests.push(new Request(input, init))
      return requests.length === 1
        ? jsonResponse({ nonce: "nonce-123" })
        : jsonResponse({ token: "session-token", user_id: "user-123" })
    }

    let signedMessage = ""
    const signMessage = async (message: string) => {
      signedMessage = message
      return "signature-123"
    }

    const session = await getSignIn()(ADDRESS, signMessage)

    assert.deepEqual(session, { token: "session-token", user_id: "user-123" })
    assert.ok(signedMessage.includes(`Address: ${ADDRESS}`))
    assert.match(signedMessage, /Nonce: nonce-123/)
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url, "http://test.local/v1/auth/nonce")
    assert.equal(requests[0].method, "POST")
    assert.equal(requests[1].url, "http://test.local/v1/auth/verify-stellar")
    assert.deepEqual(await requests[1].json(), {
      address: ADDRESS,
      message: signedMessage,
      signature: "signature-123",
    })
  })

  it("stops after a rejected wallet signature", async () => {
    let requestCount = 0
    globalThis.fetch = async () => {
      requestCount += 1
      return jsonResponse({ nonce: "nonce-123" })
    }

    const signMessage = async () => {
      throw new Error("User rejected the request")
    }

    await assert.rejects(
      getSignIn()(ADDRESS, signMessage),
      /User rejected the request/
    )
    assert.equal(requestCount, 1)
  })

  it("propagates an API error from signature verification", async () => {
    globalThis.fetch = async (_input, init) => {
      const request = new Request(_input, init)
      if (request.url.endsWith("/v1/auth/nonce")) return jsonResponse({ nonce: "nonce-123" })
      return jsonResponse(
        { error: { code: "unauthorized", message: "Invalid signature" } },
        403
      )
    }

    await assert.rejects(
      getSignIn()(ADDRESS, async () => "signature-123"),
      (error: unknown) => {
        assert.equal(error instanceof Error, true)
        assert.equal((error as { status: number }).status, 403)
        assert.equal((error as { code: string }).code, "unauthorized")
        assert.equal((error as Error).message, "Invalid signature")
        return true
      }
    )
  })
})
