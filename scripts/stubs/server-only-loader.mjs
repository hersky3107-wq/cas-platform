/**
 * Node ESM resolver hook that maps the bare `server-only` specifier to an empty
 * module.
 *
 * WHY: `server-only` is a build-time guard that Next.js aliases away in its own
 * bundler; it is not resolvable from a plain `tsx` process. Verification
 * scripts that need to exercise real server modules (`lib/credits-server.ts`,
 * `lib/league/public-access.ts`, ...) would otherwise die on
 * "Cannot find module 'server-only'" before running a single check.
 *
 * This affects ONLY scripts that opt in via `--import`. Application code is
 * untouched, so the guard still does its real job in the Next build.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/<script>.ts
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return { url: 'data:text/javascript,export{}', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
