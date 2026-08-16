import Module from 'node:module'
import { fileURLToPath } from 'node:url'

/**
 * Makes the bare `server-only` specifier resolvable inside a plain `tsx`
 * process. See `server-only-loader.mjs` for the full why; in short, Next.js
 * aliases that package away in its own bundler, so scripts that import real
 * server modules (`lib/credits-server.ts`, `lib/league/public-access.ts`, ...)
 * otherwise fail before running a single check.
 *
 * Both resolvers are patched because tsx executes TypeScript through CommonJS
 * `require` (the CJS branch is the one that actually fires today) while a
 * future/ESM path would go through the loader hook.
 *
 * Opt-in per script via `--import`; application code and the Next build are
 * untouched, so the real guard still works where it matters.
 */
const EMPTY = fileURLToPath(new URL('./server-only-empty.cjs', import.meta.url))

const originalResolve = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (request === 'server-only') return EMPTY
  return originalResolve.call(this, request, ...rest)
}

Module.register?.('./server-only-loader.mjs', import.meta.url)
