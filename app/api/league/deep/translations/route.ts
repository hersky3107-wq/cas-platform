import { NextResponse } from 'next/server'
import { authorizeRoundForViewer, resolveLeagueViewer } from '@/lib/league/public-access'
import { loadDeepRun, type DeepProduct } from '@/lib/league/deep-store'
import { buildDeepSnapshot } from '@/lib/league/deep-snapshot'
import { shouldTranslateDeepLocale } from '@/lib/league/deep-display'
import { translateDeepSnapshot } from '@/lib/league/deep-i18n'
import { normalizeLeagueLocale } from '@/lib/league/i18n/locales'

export const maxDuration = 60

/**
 * GET /api/league/deep/translations?round_id=&kind=&locale=
 *
 * View-time deep-analysis translations. The card client calls this whenever
 * translatable briefs appear (poll / resume), not only on first mount.
 * Serves the cache when warm; one batched cheap-model call on a miss.
 * Never blocks generation. On failure the client keeps the English originals.
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const { searchParams } = new URL(req.url)
  const roundId = searchParams.get('round_id')?.trim() || ''
  const kindRaw = searchParams.get('kind')?.trim() || ''
  const locale = normalizeLeagueLocale(searchParams.get('locale')) ?? 'en'
  if (!roundId) return NextResponse.json({ error: 'round_id required' }, { status: 400 })
  if (kindRaw !== 'open' && kindRaw !== 'debate') {
    return NextResponse.json({ error: 'kind must be open or debate' }, { status: 400 })
  }
  const kind: DeepProduct = kindRaw

  if (!viewer.isAdmin) {
    const access = await authorizeRoundForViewer(viewer, roundId)
    if (!access.ok) return access.response
  }

  if (!shouldTranslateDeepLocale(locale)) {
    return NextResponse.json({ translations: {}, locale })
  }

  const row = await loadDeepRun(roundId, kind, viewer.userId)
  if (!row) return NextResponse.json({ translations: {}, locale })

  const snapshot = buildDeepSnapshot(row.product, row.state)
  if (!snapshot) return NextResponse.json({ translations: {}, locale })

  try {
    const result = await translateDeepSnapshot({
      runId: row.id,
      locale,
      snapshot,
    })
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
