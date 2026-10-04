/**
 * AIRANK official-outcome resolver — first LMArena snapshot on/after
 * max(deadline, opened date). Pending snapshots stay `auto` for the daily
 * refresh; VOID never enters the operator queue.
 */

import 'server-only'

import { VOID_UNRESOLVABLE_REASON } from '@/lib/league/manual-grade/types'
import type { ResolvedOutcome } from '@/lib/prediction/resolution'
import { brandRankingFromStore, listLeaderboardPublishDates, LMARENA_SOURCE } from './ingest'
import { leaderboardStoreArena } from './meta'
import { supabaseAdmin } from '@/lib/supabase/server'
import { firstSnapshotOnOrAfter, gradeAirankSnapshot, type SnapshotBrandRow, type SnapshotModelRow } from './grade'
import { decodeAirankInstrument, isAirankInstrument } from './instrument'
import {
  candidateListFromRanking,
  decodeActualTableOutcome,
  decodeBrandTableRanking,
  gradeBrandTableRanking,
  isBrandTableInstrument,
  mapActualBrandsToCandidates,
} from './brand-table'
import { mapVendorBrand } from './brands'

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
    .select('model,brand,organization,rank,score')
    .eq('source', LMARENA_SOURCE)
    .eq('arena', leaderboardStoreArena(parts.arena))
    .eq('category', parts.category)
    .eq('publish_date', publishDate)
    .order('rank', { ascending: true })
  if (error) throw new Error(`league_ai_leaderboard snapshot read failed: ${error.message}`)

  const brands = await brandRankingFromStore(LMARENA_SOURCE, parts.arena, parts.category, publishDate)
  const models: SnapshotModelRow[] = (data ?? []).map((row) => ({
    model: String(row.model),
    brand: mapVendorBrand(
      row.organization == null ? null : String(row.organization),
      String(row.model),
    ).brand,
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

export async function gradeBrandTableChildren(roundId: string): Promise<number> {
  const { data: round, error: roundErr } = await supabaseAdmin
    .from('prediction_rounds')
    .select('instrument, opened_at, created_at, closed_book_packet_text')
    .eq('id', roundId)
    .maybeSingle()
  if (roundErr || !round || !isBrandTableInstrument(String(round.instrument))) return 0

  const official = await resolveAirankOfficial(
    String(round.instrument),
    round.opened_at ? String(round.opened_at) : round.created_at ? String(round.created_at) : null,
  )
  if (!official || official.status !== 'resolved') return 0
  const decoded = decodeActualTableOutcome(official.outcome.rawOutcome)
  if (!decoded.ranking.length) return 0

  const { data: preds, error: predErr } = await supabaseAdmin
    .from('model_predictions')
    .select('id, predicted_qualifier_text, league_tier')
    .eq('round_id', roundId)
  if (predErr || !preds) return 0

  const parts = decodeAirankInstrument(String(round.instrument))
  const openedYmd = String(round.opened_at ?? round.created_at ?? '').slice(0, 10)
  let candidates: string[] = []
  if (parts && openedYmd) {
    const openSnap = await brandRankingFromStore(LMARENA_SOURCE, parts.arena, parts.category, openedYmd).catch(() => [])
    if (openSnap.length) candidates = candidateListFromRanking(openSnap as SnapshotBrandRow[])
  }
  const actual = candidates.length
    ? mapActualBrandsToCandidates(decoded.ranking, candidates)
    : decoded.ranking

  let graded = 0
  for (const row of preds) {
    const raw = row.predicted_qualifier_text == null ? '' : String(row.predicted_qualifier_text)
    const ranking = decodeBrandTableRanking(raw)
    const predicted = ranking.length ? ranking : raw.trim() ? [raw.trim()] : []
    if (!predicted.length) continue
    const grade = gradeBrandTableRanking(predicted, actual)
    const { error } = await supabaseAdmin
      .from('model_predictions')
      .update({ is_correct: grade.top1Hit })
      .eq('id', row.id)
    if (!error) graded += 1
  }
  return graded
}
