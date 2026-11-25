/** Shared browser/fetch stubs for the EngiPay hook tests. */

export interface FetchCall {
  url: string
  init?: RequestInit
}

export interface HookEnv {
  calls: FetchCall[]
  restore(): void
}

function restoreGlobal(
  name: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor)
  else delete (globalThis as Record<string, unknown>)[name]
}

/**
 * Install a session token (or none), a fetch stub and just enough of the
 * browser globals for the hooks and the real API transport to run.
 */
export function installHookEnv(
  token: string | null,
  respond: (call: FetchCall) => Response | Promise<Response>
): HookEnv {
  const originalFetch = globalThis.fetch
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const originalLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  )

  const values = new Map<string, string>()
  if (token) values.set("engipay-token", token)

  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  })
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      localStorage: storage,
      dispatchEvent: () => true,
    },
  })

  const calls: FetchCall[] = []
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const call: FetchCall = { url, init }
    calls.push(call)
    return respond(call)
  }

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch
      restoreGlobal("window", originalWindow)
      restoreGlobal("localStorage", originalLocalStorage)
    },
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** Wait for a stubbed fetch promise to settle and the hook to re-render. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for hook state")
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}
