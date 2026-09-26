/**
 * Throwaway preview only. Loads a stored session through supabaseAdmin so the
 * calibration page can render without the browser cookie the API requires.
 */
import { supabaseAdmin } from '@/lib/supabase/server'
import { talismanFromStoredSession } from '@/lib/oracle/talisman'
import type { TalismanPurpose } from '@/lib/oracle/talisman'
import { specFromComputation, talismanStats } from './from-computation'
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
  }
  arrival?: { nativeMissing: Array<{ system: string; field: string }> }
}

export async function previewFromStoredSession(
  id: string,
  purposeRaw: string | null,
): Promise<PreviewSessionPayload> {
  const purpose = purposeRaw && (PURPOSES as readonly string[]).includes(purposeRaw)
    ? (purposeRaw as TalismanPurpose)
    : null
  const { data: session, error } = await supabaseAdmin
    .from('oracle_job_sessions')
    .select('id, status, prompt_version, created_at')
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false, reason: error.message }
  if (!session) return { ok: false, reason: 'not-found' }

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
      dateLabel: String(session.created_at).slice(0, 10).replaceAll('-', '.'),
      title: 'session',
      note: `${result.computation.centre.source} · ${result.computation.centre.mode}`,
    }),
    stats: talismanStats(result.computation, result.charts),
    arrival: result.arrival,
  }
}
