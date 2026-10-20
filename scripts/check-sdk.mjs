#!/usr/bin/env node
/**
 * check-sdk.mjs — fail if lib/api-client.gen.ts is out of date.
 *
 * How it works:
 *   1. Re-runs openapi-typescript against lib/openapi.json into a temp file.
 *   2. Diffs it against the committed lib/api-client.gen.ts.
 *   3. Exits non-zero (fails CI) if they differ.
 *
 * Run with: npm run check:sdk
 *
 * In CI the backend job writes a fresh lib/openapi.json via
 * `curl http://localhost:8080/v1/openapi.json`, then this script verifies
 * that the committed gen file is still in sync.
 */

import { execSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SPEC      = new URL("../lib/openapi.json",        import.meta.url).pathname
const COMMITTED = new URL("../lib/api-client.gen.ts",   import.meta.url).pathname

const dir = mkdtempSync(join(tmpdir(), "engipay-sdk-"))
const tmp = join(dir, "api-client.gen.ts")

try {
  execSync(`npx openapi-typescript "${SPEC}" -o "${tmp}"`, { stdio: "pipe" })

  const fresh     = readFileSync(tmp,       "utf8")
  const committed = readFileSync(COMMITTED, "utf8")

  if (fresh === committed) {
    console.log("✅  lib/api-client.gen.ts is up to date.")
    process.exit(0)
  }

  // Print the diff so the developer sees exactly what changed.
  try {
    execSync(`diff "${COMMITTED}" "${tmp}"`, { encoding: "utf8", stdio: "inherit" })
  } catch {
    // diff exits 1 when files differ — expected here.
  }

  console.error(
    "\n❌  lib/api-client.gen.ts is stale.\n" +
    "    Run:  npm run generate:sdk\n" +
    "    Then commit the result.\n"
  )
  process.exit(1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
