import { describe, expect, it } from 'vitest'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import {
  CROW_ENGINE_MODEL_ID,
  CROW_PERSONA,
  buildCrowSystemPrompt,
  buildCrowUserPrompt,
  buildCrowInput,
  formatFinanceCrowBrief,
  leagueSideFromCrow,
  parseCrowOutput,
} from '../extra/crow'
import { lookupRosterEntry } from '../roster'
import { getLeagueUiPack } from '../i18n/dictionary'

function round(): RoundRow {
  return {
    id: 'round-crow',
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
    reasoning_snippet: 'ok',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-08-16T21:31:00.000Z',
    ...overrides,
  }
}

describe('crow seat', () => {
  it('runs on first-party Mistral Medium 3.5 and states the persona', () => {
    const engine = lookupRosterEntry(CROW_ENGINE_MODEL_ID)
    expect(engine?.caller).toMatchObject({ kind: 'core', provider: 'mistral', modelOverride: 'mistral-medium-3.5' })
    expect(engine?.reasoning).toBe(false)
    expect(CROW_PERSONA).toContain('NOT contrarian')
    expect(CROW_PERSONA).toContain('underdog')
    const sports = buildCrowSystemPrompt('sports')
    const gold = buildCrowSystemPrompt('commodity')
    expect(sports).toContain('single-game')
    expect(gold).toContain('mean-reversion')
    expect(sports).toContain('agree with the measured edge')
  })

  it('embeds the fact brief and does not invent a path when closes are missing', () => {
    const brief = formatFinanceCrowBrief(null)
    expect(brief).toContain('UNAVAILABLE')
    expect(brief).toContain('Do not invent')
    const steep = formatFinanceCrowBrief({
      bars: [
        { date: '2026-09-01', close: 100 },
        { date: '2026-09-20', close: 140 },
      ],
    })
    expect(steep).toContain('40.00%')
    expect(steep).toContain('not a required fade')
    const prompt = buildCrowUserPrompt(
      buildCrowInput(
        {
          proposition_text: 'Will gold close higher?',
          category: 'commodity',
          instrument: 'XAU',
          proposition_kind: 'binary_close_higher',
        },
        steep,
      ),
    )
    expect(prompt).toContain('40.00%')
    expect(prompt).toContain('FACTS YOU KNOW')
  })

  it('parses a verdict and stays out of the 40-AI consensus', () => {
    const parsed = parseCrowOutput(
      '{"direction":"down","probability":46,"rationale":"The path is a steep run; mean-reversion is the ignored downside."}',
    )
    expect(parsed?.verdict).toBe('down')
    expect(leagueSideFromCrow('down', 'binary_subject_outcome')).toBe('no')
    expect(parseCrowOutput('')).toBeNull()

    const official = [pred({}), pred({ model_id: 'qwen3.8-max', brand: 'Qwen', camp: 'china', predicted_direction: 'up' })]
    const without = buildCardData(round(), official)
    const withCrow = buildCardData(round(), [
      ...official,
      pred({
        model_id: 'crow',
        brand: '🐦‍⬛ 까마귀',
        camp: 'other',
        league_tier: 'extra',
        predicted_direction: 'down',
        predicted_value: 46,
      }),
    ])
    expect(withCrow.consensus).toEqual(without.consensus)
    expect(withCrow.consensus.totalModels).toBe(2)
    expect(withCrow.tierSplit.extra.down).toBe(1)
    expect(getLeagueUiPack('ko').extraCompare.seat.crow).toBe('까마귀')
  })
})
