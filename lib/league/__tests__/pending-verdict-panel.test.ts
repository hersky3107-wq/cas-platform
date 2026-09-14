import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PendingVerdictPanel } from '../../../components/league/PendingVerdictPanel'
import { ConsensusHero } from '../../../components/league/ConsensusHero'
import { buildCatalogRankedRoundInput } from '../catalog'
import { getLeagueUiPack } from '../i18n/dictionary'
import type { CardRoundMeta, ConsensusSummary } from '../card-types'
import { emptyTally } from '../card-types'
import { sideLabelsFor } from '../side-labels'

/**
 * Renders the ACTUAL `PendingVerdictPanel` component (via `react-dom/server`,
 * no jsdom/mocking) against a SYNTHETIC 3-MONTH round, so this is a real
 * render of real markup, not an assertion on the source. Confirms the panel:
 *  - shows proposition, anchor price + anchor session date, resolve date,
 *    and days remaining;
 *  - never shows a hit figure, a percentage, or renders empty.
 */
describe('PendingVerdictPanel — synthetic 3-month round', () => {
  const now = new Date('2026-08-21T20:00:00.000Z') // a Friday
  const seed = buildCatalogRankedRoundInput('AAPL', '3m', now)
  if (!seed) throw new Error('AAPL is expected to be a catalog instrument')

  const round: CardRoundMeta = {
    round_id: 'synthetic-3m-round',
    instrument: seed.instrument,
    category: seed.category,
    horizon: seed.horizon,
    resolution_rule: seed.resolution_rule,
    proposition_text: seed.proposition_text,
    proposition_kind: 'binary_close_higher',
    subject_label: null,
    color_bucket: 'green',
    resolves_at: seed.resolves_at,
    opened_at: now.toISOString(),
    resolved_at: null,
    actual_outcome: null,
    gradingState: 'not_due',
    unresolvableReason: null,
    anchorPrice: 231.45,
    anchorPriceAt: now.toISOString(),
    anchorSessionDate: '2026-08-21',
    resolutionSessionDate: null,
    resolutionPrice: null,
    actualMagnitudePct: null,
    livePrice: null,
    livePriceAt: null,
    operatorEvidence: null,
  }

  const t = getLeagueUiPack('en')
  const html = renderToStaticMarkup(createElement(PendingVerdictPanel, { round, t, locale: 'en', now }))

  it('prints the rendered output', () => {
    // eslint-disable-next-line no-console
    console.log('\n=== PendingVerdictPanel — synthetic 3-month AAPL round ===\n' + html + '\n')
    expect(html.length).toBeGreaterThan(0)
  })

  it('shows the proposition, naming the actual resolve date', () => {
    expect(html).toContain(seed.proposition_text)
    expect(round.proposition_text).toContain(round.resolves_at.slice(0, 10))
  })

  it('shows the anchor price and the anchor session date', () => {
    expect(html).toContain('$231.45')
    expect(html).toMatch(/Aug 21, 2026/)
  })

  it('shows the resolve date', () => {
    const resolveDate = new Date(round.resolves_at)
    const expectedMonthDay = resolveDate.toLocaleDateString('en', { timeZone: 'UTC', month: 'short', day: 'numeric' })
    expect(html).toContain(expectedMonthDay)
  })

  it('shows days remaining, roughly matching the 3-month (~63 trading day) horizon', () => {
    const daysRemaining = Math.ceil((Date.parse(round.resolves_at) - now.getTime()) / 86_400_000)
    expect(html).toContain(`${daysRemaining} days left`)
    expect(daysRemaining).toBeGreaterThan(80) // ~63 weekdays spans well over 80 calendar days
    expect(daysRemaining).toBeLessThan(120)
  })

  it('never shows a hit figure, a percentage, or an empty section', () => {
    expect(html).not.toMatch(/[✓✗]/)
    expect(html).not.toMatch(/\d+%/)
    expect(html).not.toMatch(/\d+\/\d+/) // no "hits/graded" style fraction
    expect(html.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(20)
  })
})

describe('PendingVerdictPanel — magnitude qualifier on the headline (display only)', () => {
  const now = new Date('2026-08-21T20:00:00.000Z')
  const seed = buildCatalogRankedRoundInput('AAPL', '1d', now)
  if (!seed) throw new Error('AAPL is expected to be a catalog instrument')

  const round: CardRoundMeta = {
    round_id: 'synthetic-1d-round',
    instrument: seed.instrument,
    category: seed.category,
    horizon: seed.horizon,
    resolution_rule: seed.resolution_rule,
    proposition_text: seed.proposition_text,
    proposition_kind: 'binary_close_higher',
    subject_label: null,
    color_bucket: 'green',
    resolves_at: seed.resolves_at,
    opened_at: now.toISOString(),
    resolved_at: null,
    actual_outcome: null,
    gradingState: 'not_due',
    unresolvableReason: null,
    anchorPrice: 231.45,
    anchorPriceAt: now.toISOString(),
    anchorSessionDate: '2026-08-21',
    resolutionSessionDate: null,
    resolutionPrice: null,
    actualMagnitudePct: null,
    livePrice: null,
    livePriceAt: null,
    operatorEvidence: null,
  }

  const consensus: ConsensusSummary = {
    tally: { up: 6, down: 1, flat: 1, abstain: 0 },
    majorityDirection: 'up',
    totalModels: 8,
    respondedModels: 8,
    avgProbability: 58.4,
    aggregateDirection: 'up',
    aggregateProbability: 58.4,
    aggregateMagnitudePct: 2.4,
    aggregateMagnitudeN: 6,
  }

  const t = getLeagueUiPack('en')
  const html = renderToStaticMarkup(createElement(PendingVerdictPanel, { round, t, locale: 'en', consensus, now }))

  it('renders the two-line hero — verb answer + magnitude on line 1, tally + aggregate confidence on line 2', () => {
    expect(html).toContain('Rises')
    expect(html).toContain('+2.4%')
    expect(html).toContain('Most models called up')
    expect(html).toContain('6 up')
    expect(html).toContain('1 down')
    expect(html).toContain('aggregate confidence 58%')
    expect(html).not.toContain('lean')
    expect(html).not.toContain('6 of 8')
  })

  it('the magnitude qualifier never carries a checkmark/cross or a hit-style fraction', () => {
    expect(html).not.toMatch(/[✓✗]/)
    expect(html).not.toMatch(/\d+\/\d+/)
  })

  it('omits the qualifier entirely (not a bare "0%") when no consensus is supplied', () => {
    const bare = renderToStaticMarkup(createElement(PendingVerdictPanel, { round, t, locale: 'en', now }))
    expect(bare).not.toContain('%')
  })
})

describe('PendingVerdictPanel — pre-grading prediction axes', () => {
  const now = new Date('2026-08-21T20:00:00.000Z')
  const seed = buildCatalogRankedRoundInput('AAPL', '1d', now)
  if (!seed) throw new Error('AAPL is expected to be a catalog instrument')

  const round: CardRoundMeta = {
    round_id: 'synthetic-axes-round',
    instrument: seed.instrument,
    category: seed.category,
    horizon: seed.horizon,
    resolution_rule: seed.resolution_rule,
    proposition_text: seed.proposition_text,
    proposition_kind: 'binary_close_higher',
    subject_label: null,
    color_bucket: 'green',
    resolves_at: seed.resolves_at,
    opened_at: now.toISOString(),
    resolved_at: null,
    actual_outcome: null,
    gradingState: 'not_due',
    unresolvableReason: null,
    anchorPrice: 231.45,
    anchorPriceAt: now.toISOString(),
    anchorSessionDate: '2026-08-21',
    resolutionSessionDate: null,
    resolutionPrice: null,
    actualMagnitudePct: null,
    livePrice: null,
    livePriceAt: null,
    operatorEvidence: null,
  }

  const t = getLeagueUiPack('en')
  const labels = sideLabelsFor(round, t)
  const empty = emptyTally()
  const html = renderToStaticMarkup(
    createElement(PendingVerdictPanel, {
      round,
      t,
      locale: 'en',
      labels,
      now,
      campSplit: {
        us: { up: 9, down: 5, flat: 0, abstain: 0 },
        china: { up: 3, down: 2, flat: 0, abstain: 0 },
        other: empty,
      },
      tierSplit: {
        premier: { up: 4, down: 1, flat: 0, abstain: 0 },
        challenger: empty,
        world: empty,
        scout: { up: 2, down: 1, flat: 0, abstain: 0 },
      },
      bookSplit: {
        closed: { up: 10, down: 5, flat: 0, abstain: 0 },
        scout: { up: 2, down: 2, flat: 0, abstain: 0 },
      },
      weightsSplit: {
        closed: { up: 8, down: 4, flat: 0, abstain: 0 },
        open: { up: 4, down: 3, flat: 0, abstain: 0 },
      },
    }),
  )

  it('labels the axes as predictions, not hits, and never uses a slash-over-total', () => {
    expect(html).toContain(t.predictions.heading)
    expect(html).toContain('US · 14 models: 9 up · 5 down')
    expect(html).toContain('Own reasoning · 15 models: 10 up · 5 down')
    expect(html).toContain('Closed-weights · 12 models: 8 up · 4 down')
    expect(html).not.toMatch(/[✓✗]/)
    expect(html).not.toMatch(/\d+\/\d+/)
  })
})

describe('ConsensusHero — weighted-call help only when diverged', () => {
  const t = getLeagueUiPack('en')
  const horizon = '1d'

  it('puts a one-sentence help next to Weighted call and never names the method', () => {
    const html = renderToStaticMarkup(
      createElement(ConsensusHero, {
        consensus: {
          tally: { up: 24, down: 16, flat: 0, abstain: 0 },
          majorityDirection: 'up',
          totalModels: 40,
          respondedModels: 40,
          avgProbability: 61,
          aggregateDirection: 'down',
          aggregateProbability: 50,
          aggregateMagnitudePct: -0.4,
          aggregateMagnitudeN: 16,
        },
        horizon,
        t,
      }),
    )
    expect(html).toContain('Weighted call')
    expect(html).toContain(t.hero.weightedCallHelp)
    expect(html).not.toMatch(/log-?odds|logit|inverse/i)
    expect(html).toContain('Most models said rise')
    expect(html).toContain('<div class="text-lg font-bold leading-snug text-league-fg md:text-xl">')
    expect(html).toContain('<details')
    expect(html).not.toMatch(/<p class="text-lg font-bold leading-snug text-league-fg md:text-xl">/)
    expect(html).not.toMatch(/<p class="absolute left-0 z-10/)
  })

  it('does not render the help when majority and weighted call agree', () => {
    const html = renderToStaticMarkup(
      createElement(ConsensusHero, {
        consensus: {
          tally: { up: 34, down: 4, flat: 1, abstain: 1 },
          majorityDirection: 'up',
          totalModels: 40,
          respondedModels: 39,
          avgProbability: 61,
          aggregateDirection: 'up',
          aggregateProbability: 54,
          aggregateMagnitudePct: 2.4,
          aggregateMagnitudeN: 34,
        },
        horizon,
        t,
      }),
    )
    expect(html).not.toContain('Weighted call')
    expect(html).not.toContain(t.hero.weightedCallHelp)
    expect(html).toContain('Most models called up')
  })
})
