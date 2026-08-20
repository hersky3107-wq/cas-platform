/**
 * Oracle AI mode. Default is stub so tests and local dev never spend tokens.
 * Set ORACLE_AI_MODE=live to route layer-1 readings through real providers.
 * Layer 2 (readers / verdicts) stays on the stub regardless.
 */
export type OracleAiMode = 'stub' | 'live'

export function getOracleAiMode(env: NodeJS.ProcessEnv = process.env): OracleAiMode {
  return env.ORACLE_AI_MODE === 'live' ? 'live' : 'stub'
}

/**
 * Live layer-1 units can sit on a reasoner for a long time. The runner lease
 * is 150s (with in-flight heartbeat renewal every 20s), and four systems in a
 * chunk run in parallel, so this must stay under the lease — otherwise the
 * sweeper steals the session and we pay twice.
 */
export const ORACLE_LAYER1_LIVE_TIMEOUT_MS = 80_000
