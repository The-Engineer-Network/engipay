/**
 * Test-only module resolver for the EngiPay hook tests.
 *
 * Redirects `react` to a tiny hook runtime and `@/lib/api-client` to a test
 * client that reuses the real transport in lib/api.ts. This lets the hook
 * tests run under `node --test` with a stubbed global fetch, with no DOM and
 * without changing production code.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dirname, "..")

function localModule(relativePath) {
  return {
    url: pathToFileURL(path.join(root, relativePath)).href,
    shortCircuit: true,
  }
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === "react") return localModule("lib/test-hook-react.ts")
  if (specifier === "@/lib/api-client") {
    return localModule("lib/test-engipay-api-client.ts")
  }

  if (!specifier.startsWith("@/")) return nextResolve(specifier, context)

  const base = path.join(root, specifier.slice(2))
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
