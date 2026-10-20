# Note to maintainers: Tailwind CSS 4 upgrade (#431)

This upgrade cannot be done safely without running npm: it changes the
lockfile, the PostCSS setup and the stylesheet entry point together, and the
result has to be checked in a build and in light and dark themes. Hand-edited
config would leave the build half-migrated, so none is included here.

## Steps needed (in an environment that can run npm and `next build`)

1. `npm install -D tailwindcss@^4 @tailwindcss/postcss@^4` and
   `npm uninstall autoprefixer` (Tailwind 4 handles prefixes itself).
   Keep the `postcss` override in `package.json` in sync.
2. Replace `postcss.config.mjs` with:

   ```js
   const config = { plugins: { "@tailwindcss/postcss": {} } }
   export default config
   ```
3. In `app/globals.css` replace the `@tailwind base/components/utilities`
   directives with `@import "tailwindcss";`, add
   `@plugin "tailwindcss-animate";`, and move the theme (colors, radius,
   fonts, keyframes) from `tailwind.config.js` into an `@theme` block (or keep
   the file with `@config "../tailwind.config.js";` as a first step).
   Delete `tailwind.config.js` once nothing needs it.
4. Run `npx @tailwindcss/upgrade` to rename changed utilities (`shadow-sm` to
   `shadow-xs`, `rounded` to `rounded-sm`, `outline-none` to `outline-hidden`,
   `ring` default width 3px to 1px, and so on) and fix the border and
   placeholder color defaults that changed.
5. `npm audit fix` for `sharp` and `source-map-js`, then confirm
   `npm audit --audit-level=high` exits 0 (`braces`, `micromatch` and
   `chokidar` leave with Tailwind 3).
6. Check every page in light and dark themes and attach before and after
   screenshots to the pull request.
