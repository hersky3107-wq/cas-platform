/**
 * Load a 부적 spec from a stored integrated session. Open (no-owner) lookup
 * is local development only. Vercel / production require the owner. A
 * missing row and a row owned by someone else return the same payload.
 */
import { supabaseAdmin } from '@/lib/supabase/server'
import { talismanFromStoredSession, talismanSerialFromEnv } from '@/lib/oracle/talisman'
import type { TalismanPurpose } from '@/lib/oracle/talisman'
import { specFromComputation, talismanStats } from './from-computation'
import { PREVIEW_SESSION_MISS, previewSessionGate } from './preview-access'
import type { TalismanSpec } from './variants'

const PURPOSES: readonly TalismanPurpose[] = ['wealth', 'love', 'promotion', 'health', 'exorcism']

export type PreviewSessionPayload = {
  ok: boolean
  reason?: string
  spec?: TalismanSpec
  stats?: {
    seals: number
    emptyPalaces: number
    hyungbang: number
    centreSource: string
    centreMode: string
    centreElement: string | null
    centrePath?: string
    centreIntensity?: string
    secondaryElement?: string | null
    absentElements?: readonly string[]
  }
  arrival?: { nativeMissing: Array<{ system: string; field: string }> }
}

export async function previewFromStoredSession(
  id: string,
  purposeRaw: string | null,
  ownerUserId: string | null,
): Promise<PreviewSessionPayload> {
  const gate = previewSessionGate(process.env, ownerUserId)
  if (!gate.proceed) return PREVIEW_SESSION_MISS

  const purpose = purposeRaw && (PURPOSES as readonly string[]).includes(purposeRaw)
    ? (purposeRaw as TalismanPurpose)
    : null
  let query = supabaseAdmin
    .from('oracle_job_sessions')
    .select('id, user_id, status, prompt_version, created_at, session_inputs')
    .eq('id', id)
  if (gate.userId) query = query.eq('user_id', gate.userId)
  const { data: session, error } = await query.maybeSingle()
  if (error) return { ok: false, reason: error.message }
  if (!session) return PREVIEW_SESSION_MISS

  const [{ data: computations }, { data: consensus }] = await Promise.all([
    supabaseAdmin.from('oracle_computations').select('system, result').eq('session_id', id),
    supabaseAdmin.from('oracle_consensus').select('deficiency_vector').eq('session_id', id).maybeSingle(),
  ])

  const result = talismanFromStoredSession({
    session,
    computations: computations ?? [],
    deficiency: (consensus?.deficiency_vector as Record<string, unknown> | null) ?? null,
    purpose,
  })
  if (!result.computation) {
    return { ok: false, reason: result.reason, arrival: result.arrival }
  }
  return {
    ok: true,
    spec: specFromComputation(result.computation, result.charts, {
      sessionId: session.id,
      dateLabel: '',
      serial: talismanSerialFromEnv(session.id),
      title: 'session',
      note: `${result.computation.centre.source} · ${result.computation.centre.mode}`,
    }),
    stats: talismanStats(result.computation, result.charts),
    arrival: result.arrival,
  }
}
