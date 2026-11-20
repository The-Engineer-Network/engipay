/**
 * The web app imports with the `@/` alias from tsconfig paths, which Node's
 * type stripping does not understand. Registering this resolver lets the unit
 * tests import modules such as lib/assets.ts directly, with no bundler.
 */
import { register } from "node:module"

register("./test-alias-hooks.mjs", import.meta.url)
