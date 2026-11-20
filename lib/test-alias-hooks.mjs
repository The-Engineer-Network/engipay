import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dirname, "..")

/** `@/lib/tokens` means `<repo>/lib/tokens`. Node needs the extension. */
export function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context)

  const base = path.join(root, specifier.slice(2))
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
