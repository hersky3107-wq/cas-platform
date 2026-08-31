/**
 * Freeze the BEFORE bytes for the side-pair render refactor (2026-08-31).
 *
 * Dumps round 71aedfd3… (AAPL 1d, graded) + 65192045… (unresolvable) from the
 * DB into JSON fixtures, then renders the verdict panel / consensus hero /
 * division board (ko + en) and the record-room CSV with the CURRENT code and
 * writes the exact bytes under lib/league/__tests__/fixtures/before/. The
 * post-refactor parity test re-renders from the same JSON fixtures and
 * byte-compares against these files.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/freeze-71aedfd3-render.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { supabaseAdmin } from '../lib/supabase/server'
import { buildCardData, type PredictionRow, type RoundRow } from '../lib/league/card-aggregate'
import { getLeagueUiPack } from '../lib/league/i18n/dictionary'
import { buildRecordRoomPage, type RecordRoomPredictionRow, type RecordRoomRoundRow } from '../lib/league/record-room-aggregate'
import { recordRoomToCsv } from '../lib/league/record-room-csv'
import type { VerdictCrossRoundGrade } from '../lib/league/verdict-aggregate'
import { VerdictPanel } from '../components/league/VerdictPanel'
import { ConsensusHero } from '../components/league/ConsensusHero'
import { DivisionBoard } from '../components/league/DivisionBoard'

const ROUND_COLUMNS =
  'id, proposition_text, category, color_bucket, instrument, horizon, resolution_rule, resolves_at, opened_at, ' +
  'actual_outcome, resolved_at, item_type, anchor_price, anchor_price_at, grading_busy_until, grading_attempted_at, ' +
  'unresolvable_reason, anchor_session_date, resolution_session_date, resolution_price, proposition_kind, subject_label'

const PREDICTION_COLUMNS =
  'id, model_id, brand, camp, league_tier, predicted_direction, predicted_value, predicted_magnitude_pct, ' +
  'predicted_qualifier_text, reasoning_snippet, is_correct, cost_usd, predicted_at'

const FIXTURES = join(__dirname, '..', 'lib', 'league', '__tests__', 'fixtures')
const BEFORE = join(FIXTURES, 'before')

type AnyRow = Record<string, unknown>

async function findRoundByPrefix(prefix: string): Promise<AnyRow> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select(ROUND_COLUMNS)
    .order('opened_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  const hit = (data as AnyRow[]).find((r) => String(r.id).startsWith(prefix))
  if (!hit) throw new Error(`no round with id prefix ${prefix}`)
  return hit
}

async function loadPredictions(roundId: string): Promise<AnyRow[]> {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select(PREDICTION_COLUMNS)
    .eq('round_id', roundId)
    .order('predicted_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as AnyRow[]
}

async function loadCrossRound(instrument: string): Promise<VerdictCrossRoundGrade[]> {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, round_id, is_correct, prediction_rounds!inner(instrument, resolved_at)')
    .eq('prediction_rounds.instrument', instrument)
    .not('is_correct', 'is', null)
  if (error) throw new Error(error.message)
  const out: VerdictCrossRoundGrade[] = []
  for (const row of (data ?? []) as AnyRow[]) {
    const joined = Array.isArray(row.prediction_rounds)
      ? (row.prediction_rounds[0] as AnyRow | undefined)
      : (row.prediction_rounds as AnyRow | null)
    const resolvedAt = joined?.resolved_at
    if (!resolvedAt || row.is_correct === null) continue
    out.push({
      model_id: String(row.model_id),
      round_id: String(row.round_id),
      is_correct: Boolean(row.is_correct),
      resolved_at: String(resolvedAt),
    })
  }
  // Stable order so the fixture (and every render fed by it) is deterministic.
  out.sort((a, b) => a.round_id.localeCompare(b.round_id) || a.model_id.localeCompare(b.model_id))
  return out
}

function writeJson(name: string, value: unknown): void {
  writeFileSync(join(FIXTURES, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  console.log(`fixture written: ${name}`)
}

function writeBefore(name: string, value: string): void {
  writeFileSync(join(BEFORE, name), value, 'utf8')
  console.log(`before-bytes written: ${name} (${Buffer.byteLength(value)} bytes)`)
}

async function main() {
  mkdirSync(BEFORE, { recursive: true })

  const graded = await findRoundByPrefix('71aedfd3')
  const gradedPredictions = await loadPredictions(String(graded.id))
  const crossRound = await loadCrossRound(String(graded.instrument))
  const unresolvable = await findRoundByPrefix('65192045')
  const unresolvablePredictions = await loadPredictions(String(unresolvable.id))

  writeJson('71aedfd3-round.json', graded)
  writeJson('71aedfd3-predictions.json', gradedPredictions)
  writeJson('71aedfd3-crossround.json', crossRound)
  writeJson('65192045-round.json', unresolvable)
  writeJson('65192045-predictions.json', unresolvablePredictions)

  const card = buildCardData(
    graded as unknown as RoundRow,
    gradedPredictions as unknown as PredictionRow[],
    undefined,
    crossRound
  )
  console.log(
    `card: ${card.round.round_id} gradingState=${card.round.gradingState} hit=${card.verdict.hitRecord.hits}/${card.verdict.hitRecord.graded} ` +
      `tally=${card.consensus.tally.up}▲ ${card.consensus.tally.down}▼ abstain=${card.consensus.tally.abstain}`
  )

  const magnitudeCompare =
    card.consensus.aggregateMagnitudePct !== null && card.round.actualMagnitudePct !== null
      ? { predictedPct: card.consensus.aggregateMagnitudePct, actualPct: card.round.actualMagnitudePct }
      : null

  for (const locale of ['ko', 'en'] as const) {
    const t = getLeagueUiPack(locale)
    writeBefore(
      `71aedfd3-verdict-panel.${locale}.html`,
      renderToStaticMarkup(
        createElement(VerdictPanel, {
          verdict: card.verdict,
          models: card.models,
          t,
          consensus: card.consensus,
          horizon: card.round.horizon,
          magnitudeCompare,
        })
      )
    )
    writeBefore(
      `71aedfd3-hero.${locale}.html`,
      renderToStaticMarkup(
        createElement(ConsensusHero, {
          consensus: card.consensus,
          horizon: card.round.horizon,
          t,
          magnitudeCompare,
        })
      )
    )
    writeBefore(
      `71aedfd3-division-board.${locale}.html`,
      renderToStaticMarkup(
        createElement(DivisionBoard, {
          models: card.models,
          tierSplit: card.tierSplit,
          t,
          roundGraded: card.round.gradingState === 'graded',
          actualMagnitudePct: card.round.actualMagnitudePct,
        })
      )
    )
  }

  const csvPage = buildRecordRoomPage(
    [graded as unknown as RecordRoomRoundRow],
    (gradedPredictions as AnyRow[]).map((p) => ({
      round_id: String(graded.id),
      model_id: String(p.model_id),
      brand: String(p.brand),
      camp: String(p.camp),
      league_tier: String(p.league_tier),
      predicted_direction: (p.predicted_direction as string | null) ?? null,
      is_correct: (p.is_correct as boolean | null) ?? null,
    })) as RecordRoomPredictionRow[],
    1,
    20,
    1
  )
  writeBefore('71aedfd3-record-room.csv', recordRoomToCsv(csvPage))

  console.log('done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
