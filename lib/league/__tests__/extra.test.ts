import { describe, expect, it } from 'vitest'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import {
  extraExperimentalDisclaimer,
  assertApprovedCopy,
  assertExtraExperimentalDisclaimer,
} from '../compliance'
import {
  assertNoPacketOnDivinationInput,
  buildDivinationInput,
  customerFacingDivination,
  estimatedDivinationCostUsd,
  findInternalDivinationLeak,
  leagueProbabilityFromOracleConfidence,
  leagueSideFromDivination,
} from '../extra/divination'
import {
  DIVINATION_CUSTOMER_KEYS,
  DIVINATION_VOTING_SYSTEM_COUNT,
  EXTRA_EXPERIMENTAL_DISCLAIMER_KO,
  divinationConfidenceLabel,
  divinationConfidenceTier,
  mentionsSixSystems,
} from '../extra/copy'
import {
  EXTRA_SEAT_IDS,
  LEAGUE_EXTRA_ROSTER,
  extraSeatBadge,
  isExtraSeat,
  officialRowsForConsensus,
} from '../extra/seats'
import { LEAGUE_UI, getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { buildLeaderboardData, type GradedPredictionRow } from '../leaderboard-aggregate'
import { LEAGUE_ROSTER } from '../roster'
import type { LeagueDivinationAdapterOutput } from '@/lib/oracle/league-divination/adapter-types'

function round(): RoundRow {
  return {
    id: 'round-extra',
    proposition_text: 'Will AAPL close higher 24h from now?',
    category: 'stock',
    color_bucket: 'green',
    instrument: 'AAPL',
    horizon: '1d',
    resolution_rule: 'NASDAQ regular-session close',
    resolves_at: '2026-08-17T15:31:00.000Z',
    opened_at: '2026-08-16T21:30:00.000Z',
    actual_outcome: null,
    resolved_at: null,
  }
}

function pred(overrides: Partial<PredictionRow>): PredictionRow {
  return {
    model_id: 'gpt-5.6-sol',
    brand: 'OpenAI',
    camp: 'us',
    league_tier: 'premier',
    predicted_direction: 'up',
    predicted_value: 70,
    reasoning_snippet: 'Momentum.',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-08-16T21:31:00.000Z',
    ...overrides,
  }
}

function adapterOut(over: Partial<LeagueDivinationAdapterOutput> = {}): LeagueDivinationAdapterOutput {
  return {
    verdict: 'up',
    pick: 'A',
    rationale: 'Four voting systems lean plus.',
    confidence: 0.38,
    votedCount: 3,
    ichingAlone: false,
    systems: [
      {
        id: 'iching',
        ballot: 'up',
        weight: 3,
        status: 'voted',
        statusLabel: '표를 냄',
        reason: null,
        unreadableCode: null,
        source: null,
        chart: {},
      },
    ],
    ...over,
  }
}

describe('extra roster', () => {
  it('keeps the official 41 and adds four extra seats below scout', () => {
    expect(LEAGUE_ROSTER).toHaveLength(41)
    expect(LEAGUE_EXTRA_ROSTER).toHaveLength(4)
    expect(EXTRA_SEAT_IDS).toEqual(['divination', 'sentiment', 'history', 'consensus'])
    expect(LEAGUE_EXTRA_ROSTER.map((s) => s.badge)).toEqual(['🔮', '📰', '📜', '💰'])
    expect(LEAGUE_EXTRA_ROSTER.every((s) => s.league_tier === 'extra')).toBe(true)
    expect(extraSeatBadge('divination')).toBe('🔮')
  })

  it('divination copy is 4 voting systems, never 6체계', () => {
    expect(DIVINATION_VOTING_SYSTEM_COUNT).toBe(4)
    expect(mentionsSixSystems('6체계')).toBe('6체계')
    expect(mentionsSixSystems('4 voting systems')).toBeNull()
    expect(() => assertApprovedCopy('6체계')).toThrow(/6체계/)
  })
})

describe('divination adapter contract', () => {
  it('builds the 6 oracle keys and never a packet', () => {
    const input = buildDivinationInput({
      id: 'r1',
      proposition_text: 'Will BTC close higher?',
      category: 'crypto_spot',
      instrument: 'BTC/USD',
      subject_label: 'Bitcoin',
      opened_at: '2026-09-19T00:00:00.000Z',
      created_at: '2026-09-18T00:00:00.000Z',
      proposition_kind: 'binary_close_higher',
    })
    expect(input).toEqual({
      proposition: 'Will BTC close higher?',
      propositionType: 'binary',
      category: 'crypto',
      subjectName: 'Bitcoin',
      firstViewedAt: '2026-09-19T00:00:00.000Z',
      roundId: 'r1',
    })
    expect(() => assertNoPacketOnDivinationInput(input)).not.toThrow()
    expect(() => assertNoPacketOnDivinationInput({ ...input, packet: { prices: [1] } })).toThrow(/packet/)
    expect(() => assertNoPacketOnDivinationInput({ ...input, injection: 'tape' })).toThrow(/injection/)
  })

  it('exposes only verdict/pick/rationale/confidence to customers', () => {
    const customer = customerFacingDivination(adapterOut())
    expect(Object.keys(customer).sort()).toEqual([...DIVINATION_CUSTOMER_KEYS].sort())
    expect(findInternalDivinationLeak(customer)).toBeNull()
    expect(findInternalDivinationLeak(adapterOut())).toBe('systems')
  })

  it('scales confidence 0.38 → 38 and does not boost it', () => {
    expect(leagueProbabilityFromOracleConfidence(0.38)).toBe(38)
    expect(leagueProbabilityFromOracleConfidence(0.4)).toBe(40)
    expect(leagueSideFromDivination('down', null, 'binary_close_higher')).toBe('down')
    expect(leagueSideFromDivination('up', 'B', 'binary_subject_outcome')).toBe('no')
  })

  it('marks HCX cost as estimated', () => {
    const cost = estimatedDivinationCostUsd(adapterOut({ costUsd: 0.004 }))
    expect(cost.costIsEstimated).toBe(true)
    expect(cost.costUsd).toBe(0.004)
    expect(cost.estimatedCostUsd).toBe(0.004)
  })
})

describe('consensus isolation', () => {
  it('extra votes stay out of hero / camp / book / weights / verdict', () => {
    const official = [
      pred({ model_id: 'gpt-5.6-sol', predicted_direction: 'up', predicted_value: 70 }),
      pred({
        model_id: 'qwen3.8-max',
        brand: 'Qwen',
        camp: 'china',
        league_tier: 'premier',
        predicted_direction: 'up',
        predicted_value: 65,
      }),
    ]
    const extraDown = pred({
      model_id: 'divination',
      brand: '🔮 점술',
      camp: 'other',
      league_tier: 'extra',
      predicted_direction: 'down',
      predicted_value: 38,
      reasoning_snippet: 'Four voting systems lean minus.',
    })
    const without = buildCardData(round(), official)
    const withExtra = buildCardData(round(), [...official, extraDown])

    expect(withExtra.models.map((m) => m.model_id)).toContain('divination')
    expect(withExtra.tierSplit.extra).toEqual({ up: 0, down: 1, flat: 0, abstain: 0 })
    expect(withExtra.consensus).toEqual(without.consensus)
    expect(withExtra.campSplit).toEqual(without.campSplit)
    expect(withExtra.bookSplit).toEqual(without.bookSplit)
    expect(withExtra.weightsSplit).toEqual(without.weightsSplit)
    expect(withExtra.hitRate).toEqual(without.hitRate)
    expect(withExtra.verdict.hitRecord).toEqual(without.verdict.hitRecord)
    expect(withExtra.consensus.avgProbability).toBe(67.5)
    expect(withExtra.consensus.avgProbability).not.toBe(57.7)
  })

  it('keeps unwired extra stubs on the board as 미응답, not as invented votes', () => {
    const card = buildCardData(round(), [
      pred({ model_id: 'gpt-5.6-sol', predicted_direction: 'up', predicted_value: 70 }),
      pred({
        model_id: 'sentiment',
        brand: '📰 심리·내러티브',
        camp: 'other',
        league_tier: 'extra',
        predicted_direction: null,
        predicted_value: null,
        reasoning_snippet: 'engine not wired',
      }),
    ])
    expect(card.models.some((m) => m.model_id === 'sentiment' && m.direction === null)).toBe(true)
    expect(card.tierSplit.extra.abstain).toBe(1)
    expect(card.consensus.respondedModels).toBe(1)
  })

  it('keeps extra off camp / method / combined, on the unified model board', () => {
    const rows: GradedPredictionRow[] = [
      {
        model_id: 'gpt-5.6-sol',
        brand: 'OpenAI',
        camp: 'us',
        league_tier: 'premier',
        category: 'stocks',
        is_correct: true,
        round_id: 'r1',
        predicted_direction: 'up',
      },
      {
        model_id: 'divination',
        brand: '🔮 점술',
        camp: 'other',
        league_tier: 'extra',
        category: 'stocks',
        is_correct: false,
        round_id: 'r1',
        predicted_direction: 'down',
      },
    ]
    const data = buildLeaderboardData(rows)
    expect(data.model.rows.map((r) => r.key)).toEqual(expect.arrayContaining(['gpt-5.6-sol', 'divination']))
    expect(data.tier.rows.map((r) => r.key)).toEqual(expect.arrayContaining(['premier', 'extra']))
    expect(data.camp.rows.map((r) => r.key)).toEqual(['us'])
    expect(data.method.rows.map((r) => r.key)).toEqual(['pure_reasoning'])
    expect(data.combined.n).toBe(1)
    expect(data.combined.correct).toBe(1)
    expect(officialRowsForConsensus(rows)).toHaveLength(1)
    expect(isExtraSeat(rows[1]!)).toBe(true)
  })
})

describe('extra experimental disclaimer', () => {
  it('is present in every locale and uses the Korean product line', () => {
    expect(LEAGUE_UI.ko.disclaimer.extraExperimental).toBe(EXTRA_EXPERIMENTAL_DISCLAIMER_KO)
    for (const locale of LEAGUE_LOCALES) {
      const line = extraExperimentalDisclaimer(getLeagueUiPack(locale))
      assertExtraExperimentalDisclaimer(line)
      expect(mentionsSixSystems(line)).toBeNull()
    }
  })
})

describe('divination confidence qualitative display', () => {
  it('maps confidence values to weak, moderate, strong tiers on both unit and ledger scales', () => {
    // Unit scale (0..1)
    expect(divinationConfidenceTier(0.11)).toBe('weak')
    expect(divinationConfidenceTier(0.24)).toBe('weak')
    expect(divinationConfidenceTier(0.25)).toBe('moderate')
    expect(divinationConfidenceTier(0.38)).toBe('moderate')
    expect(divinationConfidenceTier(0.50)).toBe('moderate')
    expect(divinationConfidenceTier(0.51)).toBe('strong')
    expect(divinationConfidenceTier(0.85)).toBe('strong')

    // Ledger scale (0..100)
    expect(divinationConfidenceTier(11)).toBe('weak')
    expect(divinationConfidenceTier(24)).toBe('weak')
    expect(divinationConfidenceTier(25)).toBe('moderate')
    expect(divinationConfidenceTier(38)).toBe('moderate')
    expect(divinationConfidenceTier(50)).toBe('moderate')
    expect(divinationConfidenceTier(51)).toBe('strong')
    expect(divinationConfidenceTier(85)).toBe('strong')

    // Invalid / null
    expect(divinationConfidenceTier(null)).toBeNull()
    expect(divinationConfidenceTier(undefined)).toBeNull()
    expect(divinationConfidenceTier(Number.NaN)).toBeNull()
  })

  it('renders qualitative Korean labels and never raw percentages', () => {
    const ko = getLeagueUiPack('ko')
    expect(divinationConfidenceLabel(11, ko)).toBe('약한 점괘')
    expect(divinationConfidenceLabel(38, ko)).toBe('보통 점괘')
    expect(divinationConfidenceLabel(65, ko)).toBe('강한 점괘')
    expect(divinationConfidenceLabel(null, ko)).toBeNull()
  })

  it('renders localized qualitative labels across all 8 locales', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      const weak = divinationConfidenceLabel(11, pack)
      const moderate = divinationConfidenceLabel(38, pack)
      const strong = divinationConfidenceLabel(65, pack)
      expect(weak).toBeTruthy()
      expect(moderate).toBeTruthy()
      expect(strong).toBeTruthy()
      expect(weak).not.toMatch(/%/)
      expect(moderate).not.toMatch(/%/)
      expect(strong).not.toMatch(/%/)
    }
  })
})
