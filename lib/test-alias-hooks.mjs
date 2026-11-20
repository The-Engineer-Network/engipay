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
