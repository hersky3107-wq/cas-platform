/**
 * Per-call timeout policy for league deep-analysis model calls (PURE).
 *
 * Mirrors the scored-roster approach: every seat gets a bounded wall.
 * Before 2026-09-15 only the platform path (glm/solar, 120s) and the
 * DeepSeek seat (240s) were bounded — every other router seat could wait
 * on a hung upstream indefinitely, which is exactly the class of stall
 * that produced the 537s empty-content episode on the scored path.
 */
import { LEAGUE_DEEP_DEEPSEEK_TIMEOUT_MS } from './deep-deepseek'

/** Default wall for one deep model call (router or platform). */
export const LEAGUE_DEEP_DEFAULT_TIMEOUT_MS = 120_000

/**
 * Wall for one deep call. DeepSeek keeps its slower first-party budget
 * (thinking model); an explicit caller override always wins.
 */
export function leagueDeepTimeoutMs(provider: string, override?: number): number {
  if (typeof override === 'number' && override > 0) return override
  return provider === 'deepseek' ? LEAGUE_DEEP_DEEPSEEK_TIMEOUT_MS : LEAGUE_DEEP_DEFAULT_TIMEOUT_MS
}
