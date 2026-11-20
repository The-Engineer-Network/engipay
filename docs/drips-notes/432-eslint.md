# Note to maintainers: npm run lint (#432)

`npm run lint` runs `next lint`, which needs `eslint` and `eslint-config-next`.
Neither is in `package.json` or `package-lock.json` today, so the command cannot
run, and a config-only fix is not possible: a flat config that extends the
Next.js and TypeScript rule sets has nothing to import.

Adding the dependencies means regenerating `package-lock.json`, which needs
`npm install` and cannot be done by hand without risking a broken `npm ci`.

## Steps needed (in an environment that can run npm)

1. `npm install -D eslint@^9 eslint-config-next@15.5.25 @eslint/eslintrc`
2. Add `eslint.config.mjs`:

   ```js
   import { FlatCompat } from "@eslint/eslintrc"
   const compat = new FlatCompat({ baseDirectory: import.meta.dirname })
   export default [
     { ignores: [".next/**", "node_modules/**", "backend/**"] },
     ...compat.extends("next/core-web-vitals", "next/typescript"),
   ]
   ```
3. Change the `lint` script to `eslint .` (`next lint` is deprecated in Next 16).
4. Fix or justify the violations it reports, then remove `eslint.ignoreDuringBuilds`
   from `next.config.mjs`.
5. Add `- name: Lint` / `run: npm run lint` to the `web` job in
   `.github/workflows/ci.yml`, after Type check.
