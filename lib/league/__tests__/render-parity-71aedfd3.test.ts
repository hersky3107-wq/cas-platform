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
 * `SideLabels` resolver threaded through (`CardBody` behavior).
 *
 * Division-board tiles and the record-room CSV stay byte-identical to the
 * freeze (side words/glyphs on every tile). The consensus hero / verdict
 * panel were redesigned (2026-09-15) so a normal reader sees the conclusion
 * first; those surfaces keep the same ▲▼ / 오른다/내린다 / ✓N/M contract
 * but are no longer byte-frozen against the pre-redesign HTML.
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

    it(`verdict panel [${locale}] — live shape keeps price-round side/hit glyphs and the new hierarchy`, () => {
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
      expect(html).toContain(t.hero.answerVerb.up)
      expect(html).toContain(t.hero.conclusion(t.hero.answerVerb.up))
      expect(html).toContain(`${card.consensus.tally.up}▲`)
      expect(html).toContain(`${card.consensus.tally.down}▼`)
      expect(html).toContain(t.verdict.heroHits(card.verdict.hitRecord.hits, card.verdict.hitRecord.graded))
      expect(html).toContain(t.verdict.detailsToggle)
      expect(html).not.toMatch(/<details open/)
      expect(html).toContain('\u2713')
      const withoutHits = html.replace(/\u2713\d+\/\d+/g, '')
      expect(withoutHits).not.toMatch(/\d+\/\d+/)
    })

    it(`verdict panel [${locale}] — label-less legacy shape matches the labeled live shape on price rounds`, () => {
      const labeled = renderToStaticMarkup(
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
      const legacy = renderToStaticMarkup(
        createElement(VerdictPanel, {
          verdict: card.verdict,
          models: card.models,
          t,
          consensus: card.consensus,
          horizon: card.round.horizon,
          magnitudeCompare,
        })
      )
      expect(legacy).toBe(labeled)
    })

    it(`consensus hero [${locale}] — live shape keeps price-round side words and the new hierarchy`, () => {
      const html = renderToStaticMarkup(
        createElement(ConsensusHero, {
          consensus: card.consensus,
          horizon: card.round.horizon,
          t,
          labels,
          magnitudeCompare,
        })
      )
      expect(html).toContain(t.hero.countLine(
        card.consensus.totalModels,
        card.consensus.tally.up,
        t.hero.answerVerb.up,
        card.consensus.tally.down,
        t.hero.answerVerb.down,
      ))
      expect(html).toContain(t.hero.conclusion(t.hero.answerVerb.up))
      expect(html).toContain(`${card.consensus.tally.up}▲`)
      expect(html).toContain(`${card.consensus.tally.down}▼`)
      expect(html).toContain('data-testid="direction-ratio-bar"')
      expect(html).not.toMatch(/[✓✗]/)
      expect(html.replace(/\u2713\d+\/\d+/g, '')).not.toMatch(/\d+\/\d+/)
    })

    it(`consensus hero [${locale}] — label-less legacy shape matches the labeled live shape on price rounds`, () => {
      const labeled = renderToStaticMarkup(
        createElement(ConsensusHero, {
          consensus: card.consensus,
          horizon: card.round.horizon,
          t,
          labels,
          magnitudeCompare,
        })
      )
      const legacy = renderToStaticMarkup(
        createElement(ConsensusHero, {
          consensus: card.consensus,
          horizon: card.round.horizon,
          t,
          magnitudeCompare,
        })
      )
      expect(legacy).toBe(labeled)
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
      const expected = beforeBytes(`71aedfd3-division-board.${locale}.html`)
        .replace(/41개/g, '40개')
        .replace(/not 41 independent/g, 'not 40 independent')
      expect(html).toBe(expected)
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
      const expected = beforeBytes(`71aedfd3-division-board.${locale}.html`)
        .replace(/41개/g, '40개')
        .replace(/not 41 independent/g, 'not 40 independent')
      expect(html).toBe(expected)
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
