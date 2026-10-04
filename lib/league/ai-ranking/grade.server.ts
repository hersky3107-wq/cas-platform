/**
 * AIRANK official-outcome resolver — first LMArena snapshot on/after
 * max(deadline, opened date). Pending snapshots stay `auto` for the daily
 * refresh; VOID never enters the operator queue.
 */

import 'server-only'

import { VOID_UNRESOLVABLE_REASON } from '@/lib/league/manual-grade/types'
import type { ResolvedOutcome } from '@/lib/prediction/resolution'
import { brandRankingFromStore, listLeaderboardPublishDates, LMARENA_SOURCE } from './ingest'
import { supabaseAdmin } from '@/lib/supabase/server'
import { firstSnapshotOnOrAfter, gradeAirankSnapshot, type SnapshotModelRow } from './grade'
import { decodeAirankInstrument, isAirankInstrument } from './instrument'

export type AirankOfficialResult =
  | { status: 'resolved'; outcome: ResolvedOutcome }
  | { status: 'pending'; detail: string }
  | { status: 'voided'; rawOutcome: string }

function ymdFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ymd = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null
}

export async function resolveAirankOfficial(
  instrument: string,
  openedAt?: string | null,
): Promise<AirankOfficialResult | null> {
  if (!isAirankInstrument(instrument)) return null
  const parts = decodeAirankInstrument(instrument)
  if (!parts) {
    return { status: 'pending', detail: `AIRANK instrument not decodable: ${instrument}` }
  }

  const dates = await listLeaderboardPublishDates(parts.arena, parts.category)
  const createdYmd = ymdFromIso(openedAt)
  const publishDate = firstSnapshotOnOrAfter(dates, parts.deadlineYmd, createdYmd)
  if (!publishDate) {
    return {
      status: 'pending',
      detail: `no LMArena snapshot on or after ${[parts.deadlineYmd, createdYmd].filter(Boolean).join(' / ')} for ${parts.arena}/${parts.category}`,
    }
  }

  const { data, error } = await supabaseAdmin
    .from('league_ai_leaderboard')
    .select('model,brand,rank,score')
    .eq('source', LMARENA_SOURCE)
    .eq('arena', parts.arena)
    .eq('category', parts.category)
    .eq('publish_date', publishDate)
    .order('rank', { ascending: true })
  if (error) throw new Error(`league_ai_leaderboard snapshot read failed: ${error.message}`)

  const brands = await brandRankingFromStore(LMARENA_SOURCE, parts.arena, parts.category, publishDate)
  const models: SnapshotModelRow[] = (data ?? []).map((row) => ({
    model: String(row.model),
    brand: String(row.brand) as SnapshotModelRow['brand'],
    rank: Number(row.rank),
    score: row.score == null ? null : Number(row.score),
  }))

  const grade = gradeAirankSnapshot(parts, { brands, models, publishDate })
  if (grade.verdict === 'VOID') {
    return { status: 'voided', rawOutcome: grade.rawOutcome }
  }
  if (!grade.direction) {
    return { status: 'pending', detail: grade.rawOutcome }
  }
  return {
    status: 'resolved',
    outcome: {
      rawOutcome: grade.rawOutcome,
      actualDirection: grade.direction,
      anchorPrice: 0,
      anchorPriceAt: `${publishDate}T00:00:00.000Z`,
      resolutionPrice: 0,
      resolutionSessionDate: publishDate,
    },
  }
}

export { VOID_UNRESOLVABLE_REASON }
