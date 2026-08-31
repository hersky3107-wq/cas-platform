import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PendingVerdictPanel } from '../../../components/league/PendingVerdictPanel'
import { buildCatalogRankedRoundInput } from '../catalog'
import { getLeagueUiPack } from '../i18n/dictionary'
import type { CardRoundMeta, ConsensusSummary } from '../card-types'

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
    expect(html).toContain('6 of 8')
    expect(html).toContain('58% confidence')
    expect(html).not.toContain('lean')
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
