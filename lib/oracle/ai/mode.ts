/**
 * Oracle AI mode.
 *
 * Explicit `ORACLE_AI_MODE=live` is required for real models.
 * Missing the flag, `stub`, tests, and local `npm run dev` all stay on stub
 * so canned text is never a surprise token spend. The owner sets live in
 * `.env.local` when they want the real path.
 */
export type OracleAiMode = 'stub' | 'live'

export function getOracleAiMode(env: NodeJS.ProcessEnv = process.env): OracleAiMode {
  return env.ORACLE_AI_MODE?.trim() === 'live' ? 'live' : 'stub'
}

/**
 * Live layer-1 units can sit on a reasoner for a long time. The runner lease
 * is 150s (with in-flight heartbeat renewal every 20s), and four systems in a
 * chunk run in parallel, so this must stay under the lease — otherwise the
 * sweeper steals the session and we pay twice.
 */
export const ORACLE_LAYER1_LIVE_TIMEOUT_MS = 80_000
