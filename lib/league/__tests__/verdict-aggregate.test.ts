import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brandCountry } from '../country'
import { MIN_GRADED_ROUNDS_FOR_WIN_RATE } from '../credits'
import { LEAGUE_ROSTER } from '../roster'
import {
  bookFromTier,
  buildVerdictPayload,
  type VerdictCrossRoundGrade,
  type VerdictPayload,
  type VerdictPredictionRow,
  type VerdictRosterMeta,
} from '../verdict-aggregate'

type FixtureRow = {
  id: string
  model_id: string
  brand: string
  camp: string
  league_tier: string
  predicted_direction: string | null
  predicted_value: number | null
  is_correct: boolean | null
}

const FIXTURE_PATH = join(__dirname, 'fixtures', 'fffc1716-predictions.json')
const FIXTURE_ROWS = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureRow[]

const ROUND = { id: 'fffc1716-cd3d-45f2-883f-1242a373febc' }

const ROSTER: VerdictRosterMeta[] = LEAGUE_ROSTER.map((e) => ({
  model_id: e.model_id,
  camp: e.camp,
  country: brandCountry(e.brand, e.camp),
  tier: e.league_tier,
  book: bookFromTier(e.league_tier),
}))

function asPredictions(rows: FixtureRow[]): VerdictPredictionRow[] {
  return rows.map((r) => ({
    model_id: r.model_id,
    brand: r.brand,
    camp: r.camp,
    league_tier: r.league_tier,
    predicted_direction: r.predicted_direction,
    predicted_value: r.predicted_value,
    is_correct: r.is_correct,
  }))
}

/** Walk every value in the payload; fail on percent strings or single-round ratios. */
function assertNoPercentOrSingleRoundRatio(payload: VerdictPayload, singleRoundHits: number, singleRoundGraded: number) {
  const forbiddenRatio =
    singleRoundGraded > 0 ? singleRoundHits / singleRoundGraded : Number.NaN

  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined) return
    if (typeof value === 'string') {
      expect(value, `percent string at ${path}`).not.toMatch(/%$/)
      return
    }
    if (typeof value === 'number') {
      // Single-round ratio float (e.g. 29/40 = 0.725) must never appear.
      if (Number.isFinite(forbiddenRatio) && forbiddenRatio > 0 && forbiddenRatio < 1) {
        expect(value, `single-round ratio float at ${path}`).not.toBeCloseTo(forbiddenRatio, 10)
      }
      // Any bare (0,1) ratio is forbidden outside win-rate's truncated pct scale.
      if (value > 0 && value < 1) {
        throw new Error(`ratio float in (0,1) at ${path}: ${value}`)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`))
      return
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k)
      }
    }
  }

  walk(payload, '')
}

describe('buildVerdictPayload — fffc1716 fixture', () => {
  it('reports 29 hits / 40 graded / 0 ungraded from roundHitRecord only', () => {
    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: asPredictions(FIXTURE_ROWS),
      roster: ROSTER,
    })

    expect(payload.hitRecord).toEqual({ hits: 29, graded: 40, total: 40, ungraded: 0 })
    expect(payload.distribution.up + payload.distribution.down + payload.distribution.noDirection).toBe(40)
    expect(payload.distribution.up).toBe(29)
    expect(payload.distribution.down).toBe(11)
    expect(payload.distribution.noDirection).toBe(0)
  })

  it('emits raw group counts only — no ratio, percent, or rank field', () => {
    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: asPredictions(FIXTURE_ROWS),
      roster: ROSTER,
    })

    for (const group of [...payload.byCamp, ...payload.byCountry, ...payload.byTier, ...payload.byBook]) {
      expect(Object.keys(group).sort()).toEqual(['graded', 'hits', 'key', 'ungraded'])
      expect(group.hits + (group.graded - group.hits)).toBe(group.graded)
      expect(group.graded + group.ungraded).toBeGreaterThan(0)
    }

    // closed-book 34 vs scout 6 (roster size for this round).
    const closed = payload.byBook.find((g) => g.key === 'closed')
    const scout = payload.byBook.find((g) => g.key === 'scout')
    expect(closed).toMatchObject({ graded: 34, ungraded: 0 })
    expect(scout).toMatchObject({ graded: 6, ungraded: 0 })
    expect(closed!.hits + scout!.hits).toBe(29)
  })

  it('surfaces ungraded models in every group denominator display', () => {
    const mixed: VerdictPredictionRow[] = [
      {
        model_id: 'gpt-5.6-sol',
        brand: 'OpenAI',
        predicted_direction: 'up',
        predicted_value: 60,
        is_correct: true,
      },
      {
        model_id: 'qwen3.8-max',
        brand: 'Qwen',
        predicted_direction: 'down',
        predicted_value: 55,
        is_correct: null,
      },
      {
        model_id: 'solar-pro3',
        brand: 'Upstage',
        predicted_direction: null,
        predicted_value: null,
        is_correct: null,
      },
    ]
    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: mixed,
      roster: ROSTER,
    })

    expect(payload.hitRecord).toEqual({ hits: 1, graded: 1, total: 3, ungraded: 2 })
    const us = payload.byCamp.find((g) => g.key === 'us')
    const cn = payload.byCamp.find((g) => g.key === 'china')
    const other = payload.byCamp.find((g) => g.key === 'other')
    expect(us).toEqual({ key: 'us', hits: 1, graded: 1, ungraded: 0 })
    expect(cn).toEqual({ key: 'china', hits: 0, graded: 0, ungraded: 1 })
    expect(other).toEqual({ key: 'other', hits: 0, graded: 0, ungraded: 1 })
  })

  it('returns an empty array for empty groups — never a zero-filled row', () => {
    const onlyUs: VerdictPredictionRow[] = [
      {
        model_id: 'gpt-5.6-sol',
        brand: 'OpenAI',
        predicted_direction: 'up',
        predicted_value: 60,
        is_correct: true,
      },
    ]
    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: onlyUs,
      roster: ROSTER,
    })
    expect(payload.byCamp.map((g) => g.key)).toEqual(['us'])
    expect(payload.byCamp.find((g) => g.key === 'china')).toBeUndefined()
    expect(payload.byCountry.map((g) => g.key)).toEqual(['US'])
    expect(payload.byBook.map((g) => g.key)).toEqual(['closed'])
  })

  it('ranks overconfident wrong predictions by raw confidence, capped at 5, only above median', () => {
    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: asPredictions(FIXTURE_ROWS),
      roster: ROSTER,
    })

    const reported = FIXTURE_ROWS.map((r) => r.predicted_value).filter(
      (v): v is number => typeof v === 'number'
    )
    const sorted = [...reported].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median =
      sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!

    expect(payload.overconfident.length).toBeLessThanOrEqual(5)
    for (const row of payload.overconfident) {
      expect(row).toHaveProperty('confidence')
      expect(row).not.toHaveProperty('brier')
      expect(JSON.stringify(row)).not.toMatch(/허풍|brier|score/i)
      expect(row.confidence).toBeGreaterThan(median)
    }
    for (let i = 1; i < payload.overconfident.length; i++) {
      const prev = payload.overconfident[i - 1]!.confidence ?? -Infinity
      const cur = payload.overconfident[i]!.confidence ?? -Infinity
      expect(prev).toBeGreaterThanOrEqual(cur)
    }

    const wrongIds = new Set(
      FIXTURE_ROWS.filter((r) => r.is_correct === false).map((r) => r.model_id)
    )
    for (const row of payload.overconfident) expect(wrongIds.has(row.model_id)).toBe(true)
  })

  it('hides 허풍 ranking when nobody is meaningfully above the round median', () => {
    const clustered: VerdictPredictionRow[] = [
      {
        model_id: 'gpt-5.6-sol',
        brand: 'OpenAI',
        predicted_direction: 'up',
        predicted_value: 55,
        is_correct: true,
      },
      {
        model_id: 'qwen3.8-max',
        brand: 'Qwen',
        predicted_direction: 'down',
        predicted_value: 55,
        is_correct: false,
      },
      {
        model_id: 'solar-pro3',
        brand: 'Upstage',
        predicted_direction: 'up',
        predicted_value: 55,
        is_correct: true,
      },
    ]
    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: clustered,
      roster: ROSTER,
    })
    expect(payload.overconfident).toEqual([])
  })

  it('does not pad the overconfident list to a fixed length', () => {
    const oneLoudWrong: VerdictPredictionRow[] = [
      {
        model_id: 'gpt-5.6-sol',
        brand: 'OpenAI',
        predicted_direction: 'down',
        predicted_value: 80,
        is_correct: false,
      },
      {
        model_id: 'qwen3.8-max',
        brand: 'Qwen',
        predicted_direction: 'up',
        predicted_value: 50,
        is_correct: true,
      },
      {
        model_id: 'solar-pro3',
        brand: 'Upstage',
        predicted_direction: 'up',
        predicted_value: 50,
        is_correct: true,
      },
    ]
    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: oneLoudWrong,
      roster: ROSTER,
    })
    expect(payload.overconfident).toHaveLength(1)
    expect(payload.overconfident[0]!.model_id).toBe('gpt-5.6-sol')
  })

  it('omits streaks keys when graded rounds < 2 or streak is 0/1', () => {
    const cross: VerdictCrossRoundGrade[] = [
      // only one graded round — omit
      { model_id: 'solo', round_id: 'r1', is_correct: true, resolved_at: '2026-08-01T00:00:00Z' },
      // two graded, streak 1 — omit
      { model_id: 'one-streak', round_id: 'r1', is_correct: false, resolved_at: '2026-08-01T00:00:00Z' },
      { model_id: 'one-streak', round_id: 'r2', is_correct: true, resolved_at: '2026-08-02T00:00:00Z' },
      // three graded, streak 2 — include
      { model_id: 'two-streak', round_id: 'r1', is_correct: false, resolved_at: '2026-08-01T00:00:00Z' },
      { model_id: 'two-streak', round_id: 'r2', is_correct: true, resolved_at: '2026-08-02T00:00:00Z' },
      { model_id: 'two-streak', round_id: 'r3', is_correct: true, resolved_at: '2026-08-03T00:00:00Z' },
    ]

    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: asPredictions(FIXTURE_ROWS).slice(0, 1),
      roster: ROSTER,
      crossRound: cross,
    })

    expect(payload.streaks).toEqual({ 'two-streak': 2 })
    expect(payload.streaks).not.toHaveProperty('solo')
    expect(payload.streaks).not.toHaveProperty('one-streak')
  })

  it('omits crossRoundRates below MIN_GRADED_ROUNDS_FOR_WIN_RATE; uses win-rate.ts only', () => {
    const below: VerdictCrossRoundGrade[] = Array.from({ length: MIN_GRADED_ROUNDS_FOR_WIN_RATE - 1 }, (_, i) => ({
      model_id: 'below',
      round_id: `r${i}`,
      is_correct: true,
      resolved_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }))
    const at: VerdictCrossRoundGrade[] = Array.from({ length: MIN_GRADED_ROUNDS_FOR_WIN_RATE }, (_, i) => ({
      model_id: 'at-threshold',
      round_id: `r${i}`,
      is_correct: i < 7,
      resolved_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }))

    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: asPredictions(FIXTURE_ROWS).slice(0, 1),
      roster: ROSTER,
      crossRound: [...below, ...at],
    })

    expect(payload.crossRoundRates).not.toHaveProperty('below')
    expect(payload.crossRoundRates?.['at-threshold']).toEqual({
      correct: 7,
      graded: MIN_GRADED_ROUNDS_FOR_WIN_RATE,
      pct: 70,
    })
  })

  it('is structurally incapable of emitting a percent string or single-round ratio float', () => {
    const cross: VerdictCrossRoundGrade[] = Array.from({ length: MIN_GRADED_ROUNDS_FOR_WIN_RATE }, (_, i) => ({
      model_id: 'gpt-5.6-sol',
      round_id: `r${i}`,
      is_correct: i % 2 === 0,
      resolved_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }))

    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: asPredictions(FIXTURE_ROWS),
      roster: ROSTER,
      crossRound: cross,
    })

    assertNoPercentOrSingleRoundRatio(payload, 29, 40)
  })

  it('omits streaks and crossRoundRates keys entirely when no model qualifies', () => {
    const payload = buildVerdictPayload({
      round: ROUND,
      predictions: asPredictions(FIXTURE_ROWS),
      roster: ROSTER,
      crossRound: [
        { model_id: 'a', round_id: 'r1', is_correct: true, resolved_at: '2026-08-01T00:00:00Z' },
      ],
    })
    expect(payload).not.toHaveProperty('streaks')
    expect(payload).not.toHaveProperty('crossRoundRates')
  })
})
