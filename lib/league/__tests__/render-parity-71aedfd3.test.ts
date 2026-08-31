import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VerdictPanel } from '../../../components/league/VerdictPanel'
import { ConsensusHero } from '../../../components/league/ConsensusHero'
import { DivisionBoard } from '../../../components/league/DivisionBoard'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import { buildRecordRoomPage, type RecordRoomPredictionRow, type RecordRoomRoundRow } from '../record-room-aggregate'
import { recordRoomToCsv } from '../record-room-csv'
import { getLeagueUiPack } from '../i18n/dictionary'
import { sideLabelsFor } from '../side-labels'
import type { VerdictCrossRoundGrade } from '../verdict-aggregate'

/**
 * FROZEN-FIXTURE BYTE PARITY — the no-regression proof for the side-pair
 * render refactor (2026-08-31).
 *
 * `fixtures/before/*` are the EXACT bytes the pre-refactor code rendered for
 * round 71aedfd3… (a real graded AAPL 1d binary_close_higher round, its 40
 * real prediction rows and cross-round grades dumped from the DB by
 * `scripts/freeze-71aedfd3-render.ts` BEFORE any render change landed).
 *
 * This test re-renders the same fixture data with the CURRENT code — in the
 * exact configuration the live card now uses, i.e. WITH the round's
 * `SideLabels` resolver threaded through (`CardBody` behavior) — and demands
 * byte equality. If any of these assertions fails, the refactor changed what
 * a price round looks like, which the contract forbids: ▲▼, 오른다/내린다,
 * every tally/hit string must be untouched.
 *
 * The label-less legacy call shape (scripts, old callers) is asserted too,
 * so BOTH paths through the components are pinned to the same bytes.
 */

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url))

function fixture(name: string): string {
  return readFileSync(`${fixturesDir}${name}`, 'utf8')
}

function beforeBytes(name: string): string {
  return fixture(`before/${name}`)
}

const roundRow = JSON.parse(fixture('71aedfd3-round.json')) as RoundRow
const predictionRows = JSON.parse(fixture('71aedfd3-predictions.json')) as PredictionRow[]
const crossRound = JSON.parse(fixture('71aedfd3-crossround.json')) as VerdictCrossRoundGrade[]

const card = buildCardData(roundRow, predictionRows, undefined, crossRound)

const magnitudeCompare =
  card.consensus.aggregateMagnitudePct !== null && card.round.actualMagnitudePct !== null
    ? { predictedPct: card.consensus.aggregateMagnitudePct, actualPct: card.round.actualMagnitudePct }
    : null

describe('render parity — round 71aedfd3 (binary_close_higher) before vs after the side-label refactor', () => {
  it('is the round and grade the fixture froze (sanity, so parity means something)', () => {
    expect(card.round.round_id.startsWith('71aedfd3')).toBe(true)
    expect(card.round.proposition_kind).toBe('binary_close_higher')
    expect(card.round.gradingState).toBe('graded')
    expect(card.verdict.hitRecord.graded).toBeGreaterThan(0)
    expect(card.models.length).toBeGreaterThan(0)
  })

  for (const locale of ['ko', 'en'] as const) {
    const t = getLeagueUiPack(locale)
    const labels = sideLabelsFor(card.round, t)

    it(`verdict panel [${locale}] — live shape (labels passed) is byte-identical`, () => {
      const html = renderToStaticMarkup(
        createElement(VerdictPanel, {
          verdict: card.verdict,
          models: card.models,
          t,
          labels,
          consensus: card.consensus,
          horizon: card.round.horizon,
          magnitudeCompare,
        })
      )
      expect(html).toBe(beforeBytes(`71aedfd3-verdict-panel.${locale}.html`))
    })

    it(`verdict panel [${locale}] — label-less legacy shape is byte-identical too`, () => {
      const html = renderToStaticMarkup(
        createElement(VerdictPanel, {
          verdict: card.verdict,
          models: card.models,
          t,
          consensus: card.consensus,
          horizon: card.round.horizon,
          magnitudeCompare,
        })
      )
      expect(html).toBe(beforeBytes(`71aedfd3-verdict-panel.${locale}.html`))
    })

    it(`consensus hero [${locale}] — live shape (labels passed) is byte-identical`, () => {
      const html = renderToStaticMarkup(
        createElement(ConsensusHero, {
          consensus: card.consensus,
          horizon: card.round.horizon,
          t,
          labels,
          magnitudeCompare,
        })
      )
      expect(html).toBe(beforeBytes(`71aedfd3-hero.${locale}.html`))
    })

    it(`consensus hero [${locale}] — label-less legacy shape is byte-identical too`, () => {
      const html = renderToStaticMarkup(
        createElement(ConsensusHero, {
          consensus: card.consensus,
          horizon: card.round.horizon,
          t,
          magnitudeCompare,
        })
      )
      expect(html).toBe(beforeBytes(`71aedfd3-hero.${locale}.html`))
    })

    it(`division board (all model tiles) [${locale}] — live shape (labels passed) is byte-identical`, () => {
      const html = renderToStaticMarkup(
        createElement(DivisionBoard, {
          models: card.models,
          tierSplit: card.tierSplit,
          t,
          labels,
          roundGraded: card.round.gradingState === 'graded',
          actualMagnitudePct: card.round.actualMagnitudePct,
        })
      )
      expect(html).toBe(beforeBytes(`71aedfd3-division-board.${locale}.html`))
    })

    it(`division board (all model tiles) [${locale}] — label-less legacy shape is byte-identical too`, () => {
      const html = renderToStaticMarkup(
        createElement(DivisionBoard, {
          models: card.models,
          tierSplit: card.tierSplit,
          t,
          roundGraded: card.round.gradingState === 'graded',
          actualMagnitudePct: card.round.actualMagnitudePct,
        })
      )
      expect(html).toBe(beforeBytes(`71aedfd3-division-board.${locale}.html`))
    })
  }

  it('record-room CSV export is byte-identical', () => {
    const page = buildRecordRoomPage(
      [roundRow as unknown as RecordRoomRoundRow],
      predictionRows.map((p) => ({
        round_id: roundRow.id,
        model_id: p.model_id,
        brand: p.brand,
        camp: p.camp,
        league_tier: p.league_tier,
        predicted_direction: p.predicted_direction ?? null,
        is_correct: p.is_correct ?? null,
      })) as RecordRoomPredictionRow[],
      1,
      20,
      1
    )
    expect(recordRoomToCsv(page)).toBe(beforeBytes('71aedfd3-record-room.csv'))
  })
})
