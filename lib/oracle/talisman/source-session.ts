/**
 * Which finished session a 부적 can attach to: the user's own integrated
 * (12-system, personal + combined) reading that already has consensus.
 */
import { canComputeTalisman } from './access'

export function earliestIntegratedSessionId(
  sessions: ReadonlyArray<{ id: string; created_at: string }>,
): string | null {
  if (sessions.length === 0) return null
  return [...sessions].sort((a, b) => {
    const byDate = a.created_at.localeCompare(b.created_at)
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id)
  })[0]!.id
}

export function isIntegratedTalismanSource(
  session: {
    kind: string
    scope: string
    status: string
    prompt_version: string | null
    user_id?: string
  },
  viewerUserId: string,
  hasConsensus: boolean,
): boolean {
  if (session.user_id && session.user_id !== viewerUserId) return false
  if (session.kind !== 'personal') return false
  if (session.scope !== 'combined') return false
  return canComputeTalisman({
    status: session.status,
    promptVersion: session.prompt_version,
    hasConsensus,
  })
}
