import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DivisionBoard } from '../../../components/league/DivisionBoard'
import { VerdictPanel } from '../../../components/league/VerdictPanel'
import { PendingVerdictPanel } from '../../../components/league/PendingVerdictPanel'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import { formatRoundOpenedDate } from '../card-header-copy'
import { unresolvableReasonCopy, type KnownUnresolvableReason } from '../card-status'
import { buildConsensusHero } from '../compliance'
import { getLeagueUiPack, LEAGUE_UI } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { sideLabelsFor, toSideToken, tallySlotOfToken, KIND_GLYPHS } from '../side-labels'

/**
 * KIND-AWARE RENDER — the positive half of the refactor (the negative half,
 * price-round byte parity, lives in `render-parity-71aedfd3.test.ts`).
 *
 * Renders REAL components (react-dom/server, no mocks) for a
 * binary_subject_outcome round and a binary_threshold round and asserts the
 * two hard-won rules survive the new contracts:
 *  - side counts are never confusable with hit counts (no slash-over-total,
 *    no ✓/✗ on a side tally; ✓ only ever precedes a hits/graded fraction);
 *  - the qualifier (scoreline/margin) renders only as decoration next to a
 *    side badge — never inside the ✓/✗ stamp, never in a fraction.
 *
 * Plus the round-65192045 fix: an unresolvable card explains itself, in the
 * round's own kind's words, in all 8 locales for all 7 reason states.
 */

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url))

/** Visible text only — class attributes carry Tailwind opacity slashes (bg-emerald-500/15) that are not user-facing copy. */
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ')
}

const KNOWN_REASONS: readonly KnownUnresolvableReason[] = [
  'missing_anchor',
  'invalid_window',
  'series_unavailable',
  'no_series_data',
  'no_session_in_window',
  'equal_close',
  'not_price_instrument',
]

function subjectOutcomeRound(): RoundRow {
  return {
    id: 'sub-outcome-round',
    proposition_text: '맨체스터 유나이티드가 2026-09-05 경기에서 승리할까?',
    category: 'sports',
    color_bucket: 'green',
    instrument: 'EPL:MUN',
    horizon: '1d',
    resolution_rule: 'official full-time result',
    resolves_at: '2026-09-05T22:00:00.000Z',
    opened_at: '2026-09-04T09:00:00.000Z',
    actual_outcome: 'yes (full-time 2-1)',
    resolved_at: '2026-09-05T23:00:00.000Z',
    proposition_kind: 'binary_subject_outcome',
    subject_label: '맨체스터 유나이티드',
    grading_attempted_at: '2026-09-05T23:00:00.000Z',
  }
}

function subjectOutcomePredictions(): PredictionRow[] {
  const mk = (
    n: number,
    direction: string | null,
    correct: boolean | null,
    qualifier: string | null = null
  ): PredictionRow => ({
    id: `p${n}`,
    model_id: `model-${n}`,
    brand: `Brand${n}`,
    camp: n % 2 === 0 ? 'us' : 'china',
    league_tier: n < 3 ? 'premier' : n < 6 ? 'challenger' : n < 8 ? 'world' : 'scout',
    predicted_direction: direction,
    predicted_value: direction ? 62 : null,
    predicted_magnitude_pct: null,
    predicted_qualifier_text: qualifier,
    reasoning_snippet: direction ? 'form and home advantage' : null,
    is_correct: correct,
    cost_usd: 0.01,
    predicted_at: `2026-09-04T09:0${n}:00.000Z`,
  })
  return [
    mk(0, 'yes', true, '2-1'),
    mk(1, 'yes', true),
    mk(2, 'yes', true, '2-0'),
    mk(3, 'no', false),
    mk(4, 'yes', true),
    mk(5, 'no', false, '1-2'),
    mk(6, 'yes', true),
    mk(7, 'yes', true),
    mk(8, null, null),
  ]
}

describe('binary_subject_outcome — the round\u2019s own pair drives every word and glyph', () => {
  const card = buildCardData(subjectOutcomeRound(), subjectOutcomePredictions())
  const t = getLeagueUiPack('ko')
  const labels = sideLabelsFor(card.round, t)

  it('yes/no rows aggregate as sides, never as abstentions (the 40-abstain bug)', () => {
    expect(card.consensus.respondedModels).toBe(8)
    expect(card.consensus.tally.up).toBe(6) // side A slot = yes
    expect(card.consensus.tally.down).toBe(2) // side B slot = no
    expect(card.consensus.tally.abstain).toBe(1)
    expect(card.consensus.aggregateDirection).toBe('yes')
  })

  const boardHtml = renderToStaticMarkup(
    createElement(DivisionBoard, {
      models: card.models,
      tierSplit: card.tierSplit,
      t,
      labels,
      roundGraded: true,
      actualMagnitudePct: null,
    })
  )

  it('tiles show the domain pair 승/패 with Y/N glyphs — no price words, no ▲▼', () => {
    expect(boardHtml).toContain('승')
    expect(boardHtml).toContain('패')
    expect(boardHtml).not.toContain('\u25b2')
    expect(boardHtml).not.toContain('\u25bc')
    expect(boardHtml).not.toContain('상승')
    expect(boardHtml).not.toContain('하락')
  })

  it('side tallies use per-kind glyph counts, never a slash-over-total; ✓ appears only with hit fractions', () => {
    // compactTally style: "6Y 2N" — glyph-suffixed counts.
    expect(boardHtml).toMatch(/\dY/)
    // No side count may render as n/total in the VISIBLE copy. (Hit fractions
    // live in the verdict panel, not on this board.)
    expect(visibleText(boardHtml)).not.toMatch(/\d+\s*\/\s*\d+/)
  })

  it('the qualifier (scoreline) renders next to the badge and never carries ✓/✗ or joins a fraction', () => {
    expect(boardHtml).toContain('2-1')
    // The ✓/✗ stamps exist (graded tiles) but the qualifier never sits inside
    // one: the stamp span carries only the check/cross + verdict word.
    const stamps = boardHtml.match(/<span[^>]*aria-hidden="true"[^>]*>[✓✗]<\/span>/g) ?? []
    expect(stamps.length).toBeGreaterThan(0)
    expect(boardHtml).not.toMatch(/[✓✗][^<]*2-1/)
    expect(boardHtml).not.toMatch(/2-1[^<]*[✓✗]/)
  })

  const verdictHtml = renderToStaticMarkup(
    createElement(VerdictPanel, {
      verdict: card.verdict,
      models: card.models,
      t,
      labels,
      consensus: card.consensus,
      horizon: card.round.horizon,
    })
  )

  it('verdict panel: hero answers "{subject} 승", distribution legend uses Y/N, hit record keeps ✓ + total', () => {
    expect(verdictHtml).toContain('맨체스터 유나이티드 승')
    expect(verdictHtml).toContain(t.verdict.distributionHeadingSides)
    expect(verdictHtml).toContain('6Y')
    expect(verdictHtml).toContain('2N')
    // Hit record is the ONE fraction, and it carries ✓ (heroHits template).
    expect(verdictHtml).toContain(t.verdict.heroHits(6, 8))
    expect(verdictHtml).not.toContain('\u25b2')
    expect(verdictHtml).not.toContain('\u25bc')
  })

  it('hero built via buildConsensusHero names the subject, not a price verb', () => {
    const hero = buildConsensusHero(card.consensus, card.round.horizon, t, labels)
    expect(hero).not.toBeNull()
    if (hero?.kind !== 'answer') throw new Error('expected an answer hero')
    expect(hero.line1).toContain('맨체스터 유나이티드 승')
    expect(hero.line1).not.toContain(t.hero.answerVerb.up)
    expect(hero.line2).toContain('6')
  })
})

describe('binary_threshold — 상회/하회 plus the round\u2019s threshold', () => {
  const round: RoundRow = {
    id: 'threshold-round',
    proposition_text: '2026년 8월 CPI 상승률이 3.4%를 상회할까?',
    category: 'macro_indicator',
    color_bucket: 'yellow',
    instrument: 'US:CPI',
    horizon: '1w',
    resolution_rule: 'official BLS print vs stated threshold',
    resolves_at: '2026-09-10T12:30:00.000Z',
    opened_at: '2026-09-01T09:00:00.000Z',
    actual_outcome: null,
    resolved_at: null,
    proposition_kind: 'binary_threshold',
    subject_label: '3.4%',
  }
  const predictions: PredictionRow[] = [
    {
      id: 'p1',
      model_id: 'model-a',
      brand: 'BrandA',
      camp: 'us',
      league_tier: 'premier',
      predicted_direction: 'above',
      predicted_value: 58,
      predicted_magnitude_pct: null,
      predicted_qualifier_text: '+0.2%p',
      reasoning_snippet: 'sticky shelter costs',
      is_correct: null,
      cost_usd: 0.01,
      predicted_at: '2026-09-01T09:01:00.000Z',
    },
    {
      id: 'p2',
      model_id: 'model-b',
      brand: 'BrandB',
      camp: 'china',
      league_tier: 'challenger',
      predicted_direction: 'below',
      predicted_value: 55,
      predicted_magnitude_pct: null,
      predicted_qualifier_text: null,
      reasoning_snippet: 'energy base effects',
      is_correct: null,
      cost_usd: 0.01,
      predicted_at: '2026-09-01T09:02:00.000Z',
    },
  ]
  const card = buildCardData(round, predictions)
  const t = getLeagueUiPack('ko')
  const labels = sideLabelsFor(card.round, t)

  it('above/below rows are sides, and the hero names the threshold', () => {
    expect(card.consensus.tally.up).toBe(1)
    expect(card.consensus.tally.down).toBe(1)
    expect(card.consensus.tally.abstain).toBe(0)
    expect(labels.answer('above')).toBe('3.4% 상회')
    expect(labels.answer('below')).toBe('3.4% 하회')
    expect(labels.glyphs).toEqual(KIND_GLYPHS.binary_threshold)
  })

  it('tiles render 상회/하회 with >/< glyphs and the margin qualifier as decoration only', () => {
    const html = renderToStaticMarkup(
      createElement(DivisionBoard, {
        models: card.models,
        tierSplit: card.tierSplit,
        t,
        labels,
        roundGraded: false,
        actualMagnitudePct: null,
      })
    )
    expect(html).toContain('상회')
    expect(html).toContain('하회')
    expect(html).toContain('&gt;')
    expect(html).toContain('&lt;')
    expect(html).toContain('+0.2%p')
    expect(html).not.toContain('\u25b2')
    expect(html).not.toMatch(/[✓✗]/) // ungraded: no stamps at all
    expect(visibleText(html)).not.toMatch(/\d+\s*\/\s*\d+/) // and certainly no fraction
  })
})

describe('unresolvable rounds explain themselves — round 65192045 and the full reason matrix', () => {
  const roundRow = JSON.parse(readFileSync(`${fixturesDir}65192045-round.json`, 'utf8')) as RoundRow
  const predictionRows = JSON.parse(
    readFileSync(`${fixturesDir}65192045-predictions.json`, 'utf8')
  ) as PredictionRow[]

  it('the fixture is the permanently unresolvable round (no_session_in_window)', () => {
    expect(roundRow.id.startsWith('65192045')).toBe(true)
    const card = buildCardData(roundRow, predictionRows)
    expect(card.round.gradingState).toBe('unresolvable')
    expect(card.round.unresolvableReason).toBe('no_session_in_window')
  })

  for (const locale of ['en', 'ko'] as const) {
    it(`pending panel [${locale}] states the reason instead of promising a grading date`, () => {
      const card = buildCardData(roundRow, predictionRows)
      const t = getLeagueUiPack(locale)
      const html = renderToStaticMarkup(
        createElement(PendingVerdictPanel, {
          round: card.round,
          t,
          locale,
          labels: sideLabelsFor(card.round, t),
          consensus: card.consensus,
          now: new Date('2026-08-31T12:00:00.000Z'),
        })
      )
      expect(html).toContain(t.grading.unresolvable)
      expect(html).toContain(t.grading.reason.no_session_in_window)
      expect(html).toContain(t.grading.unresolvableNote)
      // The pending-round promises must be gone: this round never grades.
      expect(html).not.toContain(t.verdict.pendingHeading)
      const resolvesDate = formatRoundOpenedDate(card.round.resolves_at, locale)
      expect(html).not.toContain(t.verdict.pendingResolvesLine(resolvesDate))
      expect(html).not.toContain(t.verdict.pendingDaysRemaining(0))
      expect(html).not.toMatch(/[✓✗]/)
    })
  }

  it('all 7 reason states have per-kind wording in all 8 locales, and the tables genuinely differ by kind', () => {
    for (const locale of LEAGUE_LOCALES) {
      const t = LEAGUE_UI[locale]
      for (const reason of KNOWN_REASONS) {
        const price = unresolvableReasonCopy(reason, t, 'binary_close_higher')
        const subject = unresolvableReasonCopy(reason, t, 'binary_subject_outcome')
        const threshold = unresolvableReasonCopy(reason, t, 'binary_threshold')
        for (const copy of [price, subject, threshold]) {
          expect(copy, `${locale}/${reason}`).toBeTruthy()
          expect(copy.length, `${locale}/${reason}`).toBeGreaterThan(5)
        }
        expect(t.grading.reasonSubjectOutcome[reason], `${locale}/${reason} subject wording`).toBeTruthy()
        expect(t.grading.reasonThreshold[reason], `${locale}/${reason} threshold wording`).toBeTruthy()
      }
      // The kind tables are real translations, not copies of the price table.
      expect(t.grading.reasonSubjectOutcome.no_session_in_window).not.toBe(t.grading.reason.no_session_in_window)
      expect(t.grading.reasonThreshold.not_price_instrument).not.toBe(t.grading.reason.not_price_instrument)
      // Unknown reason still explains itself.
      expect(unresolvableReasonCopy('never_seen_reason', t, 'binary_subject_outcome')).toBeTruthy()
      expect(unresolvableReasonCopy(null, t, null)).toBe(t.grading.reason.unknown)
    }
  })

  it('legacy/unknown kinds fall back to the price wording (every pre-kind round is a price round)', () => {
    const t = LEAGUE_UI.en
    expect(unresolvableReasonCopy('equal_close', t)).toBe(t.grading.reason.equal_close)
    expect(unresolvableReasonCopy('equal_close', t, 'something_new')).toBe(t.grading.reason.equal_close)
  })
})

describe('toSideToken — the one token gate (no caller may read a valid side as abstain)', () => {
  it('passes all six contract tokens plus legacy flat; null only for null/garbage', () => {
    for (const token of ['up', 'down', 'yes', 'no', 'above', 'below', 'flat'] as const) {
      expect(toSideToken(token)).toBe(token)
    }
    expect(toSideToken(null)).toBeNull()
    expect(toSideToken(undefined)).toBeNull()
    expect(toSideToken('sideways')).toBeNull()
    expect(toSideToken('')).toBeNull()
  })

  it('every token lands in a tally slot — side A first token of each pair', () => {
    expect(tallySlotOfToken('up')).toBe('up')
    expect(tallySlotOfToken('yes')).toBe('up')
    expect(tallySlotOfToken('above')).toBe('up')
    expect(tallySlotOfToken('down')).toBe('down')
    expect(tallySlotOfToken('no')).toBe('down')
    expect(tallySlotOfToken('below')).toBe('down')
    expect(tallySlotOfToken('flat')).toBe('flat')
    expect(tallySlotOfToken(null)).toBeNull()
  })
})
