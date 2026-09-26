/**
 * Open (no-owner) service-role lookup is local development only.
 * Vercel sets NODE_ENV=production on preview as well as production, and also
 * sets VERCEL. Either signal closes the lookup.
 */

export type PreviewEnv = {
  VERCEL?: string
  NODE_ENV?: string
}

export const PREVIEW_SESSION_MISS = { ok: false as const, reason: 'not-found' as const }

export function openTalismanPreviewLookup(env: PreviewEnv): boolean {
  return env.VERCEL === undefined && env.NODE_ENV !== 'production'
}

export type PreviewSessionGate =
  | { proceed: false }
  | { proceed: true; userId: string | null }

/** Closed mode with no signed-in user never queries. Closed mode always filters by owner. */
export function previewSessionGate(env: PreviewEnv, ownerUserId: string | null): PreviewSessionGate {
  if (openTalismanPreviewLookup(env)) return { proceed: true, userId: null }
  if (!ownerUserId) return { proceed: false }
  return { proceed: true, userId: ownerUserId }
}

export function selectPreviewSession<T extends { id: string; user_id: string }>(
  rows: readonly T[],
  id: string,
  env: PreviewEnv,
  ownerUserId: string | null,
): T | typeof PREVIEW_SESSION_MISS {
  const gate = previewSessionGate(env, ownerUserId)
  if (!gate.proceed) return PREVIEW_SESSION_MISS
  const row = rows.find((item) => item.id === id && (gate.userId == null || item.user_id === gate.userId))
  return row ?? PREVIEW_SESSION_MISS
}
