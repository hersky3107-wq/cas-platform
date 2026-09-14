/**
 * Pure EXAONE → GLM seat remap for league deep-open AND deep-debate.
 * Kept out of the server-only call path so unit tests do not import
 * Friendli / OpenRouter clients.
 */

export const LEAGUE_DEAD_OPEN_PROVIDER = 'exaone'
export const LEAGUE_OPEN_REPLACEMENT_PROVIDER = 'glm-5.2'
export const LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID = 'openrouter:glm-5.2'

export function isLeagueOpenReplacementSeat(provider: string): boolean {
  return provider === LEAGUE_DEAD_OPEN_PROVIDER || provider === LEAGUE_OPEN_REPLACEMENT_PROVIDER
}

export function remapOpenPlanExaone<T extends { roles: Array<{ provider: string }> }>(plan: T): T {
  return {
    ...plan,
    roles: plan.roles.map((role) =>
      role.provider === LEAGUE_DEAD_OPEN_PROVIDER
        ? { ...role, provider: LEAGUE_OPEN_REPLACEMENT_PROVIDER }
        : role
    ),
  }
}
