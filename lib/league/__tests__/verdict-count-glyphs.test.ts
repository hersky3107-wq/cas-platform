import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VerdictPanel } from '@/components/league/VerdictPanel'
import { getLeagueUiPack } from '../i18n/dictionary'
import { brandCountry } from '../country'
import { LEAGUE_ROSTER } from '../roster'
import { bookFromTier, buildVerdictPayload, type VerdictPredictionRow, type VerdictRosterMeta } from '../verdict-aggregate'
import type { CardModelPrediction, ConsensusSummary } from '../card-types'

/** Stub consensus for panel render tests — direction tallies match fixture distributions. */
const FFFC1716_CONSENSUS: ConsensusSummary = {
  tally: { up: 29, down: 11, flat: 0, abstain: 0 },
  majorityDirection: 'up',
  totalModels: 40,
  respondedModels: 40,
  avgProbability: 62,
  aggregateDirection: 'up',
  aggregateProbability: 54,
  aggregateMagnitudePct: null,
  aggregateMagnitudeN: 0,
}

const DOWN_ROUND_CONSENSUS: ConsensusSummary = {
  tally: { up: 12, down: 28, flat: 0, abstain: 0 },
  majorityDirection: 'down',
  totalModels: 40,
  respondedModels: 40,
  avgProbability: 55,
  aggregateDirection: 'down',
  aggregateProbability: 58,
  aggregateMagnitudePct: null,
  aggregateMagnitudeN: 0,
}

/**
 * A number on screen must be unambiguously (a) a direction count or (b) a hit
 * count, from the glyph alone. Direction: ▲/▼ and never slash-over-total.
 * Hits: always ✓ and the graded total.
 */
const HIT_SHAPE = /\u2713\d+\/\d+/
const DIRECTION_GLYPH = /[▲▼]/

function assertNoBareSlashTotal(text: string) {
  const withoutHits = text.replace(/\u2713\d+\/\d+/g, '')
  expect(withoutHits, `bare slash-over-total left in: ${withoutHits}`).not.toMatch(/\d+\/\d+/)
}

function downRoundPredictions(): VerdictPredictionRow[] {
  const upWrong: VerdictPredictionRow[] = Array.from({ length: 12 }, (_, i) => ({
    model_id: `up-${i}`,
    brand: `UpBrand${i}`,
    camp: 'us',
    league_tier: 'world',
    predicted_direction: 'up',
    predicted_value: 60,
    is_correct: false,
  }))
  const downHit: VerdictPredictionRow[] = Array.from({ length: 28 }, (_, i) => ({
    model_id: `down-${i}`,
    brand: `DownBrand${i}`,
    camp: 'us',
    league_tier: 'world',
    predicted_direction: 'down',
    predicted_value: 52,
    is_correct: true,
  }))
  return [...upWrong, ...downHit]
}

function rosterFor(rows: VerdictPredictionRow[]): VerdictRosterMeta[] {
  return rows.map((r) => ({
    model_id: r.model_id,
    camp: 'us',
    country: 'US',
    tier: 'world',
    book: bookFromTier('world'),
  }))
}

function asCardModels(rows: VerdictPredictionRow[]): CardModelPrediction[] {
  return rows.map((r) => ({
    prediction_id: r.model_id,
    model_id: r.model_id,
    brand: r.brand,
    model_identifier: r.model_id,
    camp: 'us',
    league_tier: 'world',
    direction: r.predicted_direction === 'up' || r.predicted_direction === 'down' ? r.predicted_direction : null,
    probability: r.predicted_value,
    magnitude: null,
    reasoning_snippet: null,
    is_correct: r.is_correct,
    cost_usd: 0,
    predicted_at: '2026-08-18T00:00:00.000Z',
  }))
}

describe('live AAPL fffc1716 hero legend — from the card payload, not the down-round fixture', () => {
  it('renders 29▲ 11▼ from the live round predictions', () => {
    const rows = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'fffc1716-predictions.json'), 'utf8')
    ) as Array<{
      model_id: string
      brand: string
      camp: string
      league_tier: string
      predicted_direction: string | null
      predicted_value: number | null
      is_correct: boolean | null
    }>
    const predictions: VerdictPredictionRow[] = rows.map((r) => ({
      model_id: r.model_id,
      brand: r.brand,
      camp: r.camp,
      league_tier: r.league_tier,
      predicted_direction: r.predicted_direction,
      predicted_value: r.predicted_value,
      is_correct: r.is_correct,
    }))
    const roster: VerdictRosterMeta[] = LEAGUE_ROSTER.map((e) => ({
      model_id: e.model_id,
      camp: e.camp,
      country: brandCountry(e.brand, e.camp),
      tier: e.league_tier,
      book: bookFromTier(e.league_tier),
    }))
    const payload = buildVerdictPayload({
      round: { id: 'fffc1716-cd3d-45f2-883f-1242a373febc' },
      predictions,
      roster,
    })
    expect(payload.distribution.up).toBe(29)
    expect(payload.distribution.down).toBe(11)
    expect(payload.distribution.noDirection).toBe(0)

    const html = renderToStaticMarkup(
      createElement(VerdictPanel, {
        verdict: payload,
        models: asCardModels(predictions),
        t: getLeagueUiPack('ko'),
        consensus: FFFC1716_CONSENSUS,
        horizon: '1d',
      })
    )
    expect(html).toContain('29▲')
    expect(html).toContain('11▼')
    expect(html).not.toContain('12▲')
    expect(html).not.toContain('28▼')
  })
})

describe('direction counts vs hit counts — down-outcome round', () => {
  const t = getLeagueUiPack('ko')
  const predictions = downRoundPredictions()
  const payload = buildVerdictPayload({
    round: { id: 'down-round' },
    predictions,
    roster: rosterFor(predictions),
  })

  it('has numerically different direction and hit figures (unlike the AAPL up-round coincidence)', () => {
    expect(payload.hitRecord.hits).toBe(28)
    expect(payload.hitRecord.graded).toBe(40)
    expect(payload.distribution.up).toBe(12)
    expect(payload.distribution.down).toBe(28)
    expect(payload.distribution.up).not.toBe(payload.hitRecord.hits)
    expect(payload.distribution.down).toBe(payload.hitRecord.hits)
  })

  it('formats every count so the glyph alone tells direction vs hit', () => {
    const hitStrings = [
      t.verdict.heroHits(payload.hitRecord.hits, payload.hitRecord.graded),
      t.hitRate.roundResult(payload.hitRecord.hits, payload.hitRecord.graded),
      ...[...payload.byCamp, ...payload.byTier, ...payload.byBook, ...payload.byCountry].map((row) =>
        t.verdict.rawCount(row.hits, row.graded)
      ),
    ]
    const directionStrings = [
      t.bracket.compactTally({
        up: payload.distribution.up,
        down: payload.distribution.down,
        flat: 0,
        abstain: payload.distribution.noDirection,
      }),
      `${payload.distribution.up}▲`,
      `${payload.distribution.down}▼`,
    ]

    for (const s of hitStrings) {
      expect(s, `hit string missing ✓total: ${s}`).toMatch(HIT_SHAPE)
      expect(s, `hit string used a direction glyph: ${s}`).not.toMatch(DIRECTION_GLYPH)
    }
    for (const s of directionStrings) {
      expect(s, `direction string missing ▲/▼: ${s}`).toMatch(DIRECTION_GLYPH)
      expect(s, `direction string used slash-over-total: ${s}`).not.toMatch(/\d+\/\d+/)
      expect(s, `direction string used ✓: ${s}`).not.toMatch(/✓/)
    }

    const all = [...hitStrings, ...directionStrings].join('\n')
    expect(all).toContain('\u271328/40')
    expect(all).toContain('12▲')
    expect(all).toContain('28▼')
    assertNoBareSlashTotal(all)
  })

  it('renders a down-outcome panel where the hero (hits) and the bar (direction) disagree', () => {
    const html = renderToStaticMarkup(
      createElement(VerdictPanel, {
        verdict: payload,
        models: asCardModels(predictions),
        t,
        consensus: DOWN_ROUND_CONSENSUS,
        horizon: '1d',
      })
    )
    expect(html).toContain('\u271328/40')
    expect(html).toContain(t.verdict.distributionHeading)
    expect(html).toContain('12▲')
    expect(html).toContain('28▼')
    expect(html).toContain(t.headline.correlatedNote)
    expect(html.split(t.headline.correlatedNote).length - 1).toBe(1)
    assertNoBareSlashTotal(html)
  })
})
