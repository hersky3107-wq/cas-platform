import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { publishableIndices } from '@/lib/crisis/admin/publish'
import { loadRun } from '@/lib/crisis/engine/store'
import { localeFromRequest } from '@/lib/crisis/i18n/from-request'
import { cheapTranslateCaller } from '@/lib/crisis/translate/caller'
import { applyPayloadToResult } from '@/lib/crisis/translate/apply'
import { ensureCardTranslation } from '@/lib/crisis/translate/ensure'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'run id is required' }, { status: 400 })
  try {
    const run = await loadRun(supabaseAdmin, id)
    if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 })
    const { data: extra } = await supabaseAdmin
      .from('crisis_engine_runs')
      .select('published_hypothesis_ids')
      .eq('id', id)
      .maybeSingle()
    const publishedIds = Array.isArray(extra?.published_hypothesis_ids)
      ? extra.published_hypothesis_ids.map(Number)
      : []
    const locale = localeFromRequest(req)
    let result = run.result
    if (result) {
      try {
        const payload = await ensureCardTranslation(supabaseAdmin, {
          cardId: run.id ?? id,
          lang: locale,
          result,
          caller: cheapTranslateCaller,
        })
        result = applyPayloadToResult(result, payload)
      } catch {
        result = run.result
      }
    }
    return NextResponse.json({
      id: run.id,
      regionId: run.regionId,
      status: run.status,
      costUsd: run.costUsd,
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      result,
      searchUrls: run.searchUrls,
      publishable: publishableIndices(run.result),
      publishedIds,
      public: publishedIds.length > 0,
      locale,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load run'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
