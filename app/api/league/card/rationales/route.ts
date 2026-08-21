import { NextResponse } from 'next/server'
import { authorizeRoundForViewer, resolveLeagueViewer } from '@/lib/league/public-access'
import { supabaseAdmin } from '@/lib/supabase/server'
import { shouldTranslateLocale, translateRoundRationales } from '@/lib/league/rationale-i18n'
import { normalizeLeagueLocale } from '@/lib/league/i18n/locales'

/**
 * GET /api/league/card/rationales?round_id=&locale=
 *
 * View-time rationale translations. Serves the cache when warm; one batched
 * cheap-model call on a miss. Never blocks generation. On failure the client
 * keeps the English originals.
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const { searchParams } = new URL(req.url)
  const roundId = searchParams.get('round_id')?.trim() || ''
  const locale = normalizeLeagueLocale(searchParams.get('locale')) ?? 'en'
  if (!roundId) return NextResponse.json({ error: 'round_id required' }, { status: 400 })

  if (!viewer.isAdmin) {
    const access = await authorizeRoundForViewer(viewer, roundId)
    if (!access.ok) return access.response
  }

  if (!shouldTranslateLocale(locale)) {
    return NextResponse.json({ translations: {}, locale })
  }

  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('id, reasoning_snippet')
    .eq('round_id', roundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const items = (data ?? [])
    .filter((row) => typeof row.reasoning_snippet === 'string' && row.reasoning_snippet.trim())
    .map((row) => ({ predictionId: row.id as string, text: (row.reasoning_snippet as string).trim() }))

  try {
    const result = await translateRoundRationales(items, locale)
    return NextResponse.json({
      translations: result.translations,
      locale,
      fromCache: result.fromCache,
      translated: result.translated,
    })
  } catch {
    return NextResponse.json({ translations: {}, locale })
  }
}
