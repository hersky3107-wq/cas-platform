/**
 * Oracle AI mode.
 *
 * Explicit `ORACLE_AI_MODE=live|stub` always wins.
 * Tests (Vitest / NODE_ENV=test) default to stub so unit tests never spend tokens.
 * `npm run dev` and production default to live so the browser path matches the
 * live smoke script — missing the env var must not silently serve canned text.
 */
export type OracleAiMode = 'stub' | 'live'

export function getOracleAiMode(env: NodeJS.ProcessEnv = process.env): OracleAiMode {
  const raw = env.ORACLE_AI_MODE?.trim()
  if (raw === 'live') return 'live'
  if (raw === 'stub') return 'stub'
  if (env.VITEST === 'true' || env.NODE_ENV === 'test') return 'stub'
  return 'live'
}

/**
 * Live layer-1 units can sit on a reasoner for a long time. The runner lease
 * is 150s (with in-flight heartbeat renewal every 20s), and four systems in a
 * chunk run in parallel, so this must stay under the lease — otherwise the
 * sweeper steals the session and we pay twice.
 */
export const ORACLE_LAYER1_LIVE_TIMEOUT_MS = 80_000
