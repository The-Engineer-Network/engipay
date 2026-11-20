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
/**
 * Module resolve hook for tests only. Lets node's test runner load files that
 * use the "@/" path alias from tsconfig, e.g. lib/stellar-tx.ts.
 */
import { pathToFileURL } from "node:url"

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = pathToFileURL(`${process.cwd()}/${specifier.slice(2)}.ts`).href
    return nextResolve(target, context)
  }
  return nextResolve(specifier, context)
}
