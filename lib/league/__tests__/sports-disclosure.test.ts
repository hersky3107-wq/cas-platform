import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import {
  REAL_ESTATE_DEEP_GUARD,
  SPORTS_DEEP_GUARD,
  categoryDeepGuards,
  leagueAnalystSystemPrompt,
} from '../deep-prompts'
import { buildDeepSnapshot } from '../deep-snapshot'
import {
  scrubSportsDisclosure,
  scrubsSportsDisclosure,
  sportsVisibleText,
} from '../sports-disclosure'
import { consensusMoneySearchHints, buildConsensusSystemPrompt, consensusRetryInstruction } from '../extra/consensus'

const mocks = vi.hoisted(() => ({
  runSingleAiProvider: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/ai/router', () => ({
  runSingleAiProvider: (...args: unknown[]) => mocks.runSingleAiProvider(...args),
}))

const ROOT = join(__dirname, '../../..')

describe('scrubSportsDisclosure', () => {
  it('stored rationale "Pinnacle implied 58%, line -140" drops the book and American odds, keeps 58%', () => {
    const out = scrubSportsDisclosure('Pinnacle implied 58%, line -140')!
    expect(out).not.toMatch(/Pinnacle/i)
    expect(out).not.toMatch(/-140/)
    expect(out).toContain('58%')
  })

  it('removes bookmaker titles/keys and decimal / American / fractional odds in context', () => {
    const raw =
      'DraftKings moneyline @2.10 and FanDuel odds 1.85; Bet365 price +150; William Hill odds 5/2. Score 3-1 stands.'
    const out = scrubSportsDisclosure(raw)!
    expect(out).not.toMatch(/DraftKings|FanDuel|Bet365|William Hill/i)
    expect(out).not.toMatch(/@2\.10|1\.85|\+150|5\/2/)
    expect(out).toContain('3-1')
    expect(scrubSportsDisclosure('win probability 57%')).toContain('57%')
  })

  it('applies only for sports at the category gate', () => {
    expect(scrubsSportsDisclosure('sports')).toBe(true)
    expect(scrubsSportsDisclosure('stock')).toBe(false)
    expect(sportsVisibleText('sports', 'Pinnacle implied 58%')).not.toMatch(/Pinnacle/i)
    expect(sportsVisibleText('stock', 'Pinnacle implied 58%')).toContain('Pinnacle')
  })
})

describe('card headers stay unchanged', () => {
  it('sports market chrome has no bookmaker names and survives the scrubber', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      const headers = [
        pack.sportsMarket.ensembleLabel,
        pack.sportsMarket.marketBaselineLabel,
        pack.sportsMarket.divergenceLabel('+3'),
        pack.sportsMarket.fractureIron,
        pack.sportsMarket.consensusSeat,
      ]
      for (const header of headers) {
        expect(header).not.toMatch(/Pinnacle|DraftKings|FanDuel|Bet365/i)
        expect(scrubSportsDisclosure(header)).toBe(header.trim())
      }
    }
  })
})

describe('consensus sports prompts name no bookmaker', () => {
  it('hints, system, and retry use market baseline language only', () => {
    const hints = consensusMoneySearchHints('sports')
    const system = buildConsensusSystemPrompt()
    const retry = consensusRetryInstruction('sports')
    for (const blob of [hints, system, retry]) {
      expect(blob).toMatch(/시장 기준선|market baseline|betting-market-implied/)
      expect(blob).toMatch(/토토|배당|핸디캡|픽|베팅|오버언더/)
      expect(blob).not.toMatch(/Pinnacle|DraftKings|FanDuel|Bet365|sharp-book/i)
    }
  })
})

describe('deep sports output is scrubbed before return', () => {
  it('buildDeepSnapshot strips bookmaker names and odds from sports analyses', () => {
    const snap = buildDeepSnapshot('open', {
      instrument: 'MATCH:soccer_epl:1:home:1:A:B',
      category: 'sports',
      proposition: 'Will Arsenal win?',
      report: 'Pinnacle implied 58%, line -140. Scoreline watch 3-1.',
      analyses: [
        {
          roleId: 'price',
          roleLabel: 'Price analyst',
          provider: 'openai',
          ok: true,
          analysis: 'DraftKings odds 1.85; market baseline 58%.',
        },
      ],
      result: { synthesis: 'Bet365 price +150 is not a vote.' },
    })
    if (snap?.kind !== 'open') throw new Error('expected open')
    expect(snap.briefing).not.toMatch(/Pinnacle/i)
    expect(snap.briefing).not.toMatch(/-140/)
    expect(snap.briefing).toContain('58%')
    expect(snap.briefing).toContain('3-1')
    expect(snap.analyses[0]?.content).not.toMatch(/DraftKings|1\.85/)
    expect(snap.analyses[0]?.content).toContain('58%')
    expect(snap.synthesis).not.toMatch(/Bet365|\+150/)
  })

  it('does not scrub a non-sports deep snapshot', () => {
    const snap = buildDeepSnapshot('open', {
      category: 'crypto',
      report: 'Pinnacle is unrelated here',
      analyses: [],
    })
    if (snap?.kind !== 'open') throw new Error('expected open')
    expect(snap.briefing).toContain('Pinnacle')
  })
})

describe('deep prompt guards', () => {
  it('real_estate deep prompt contains the property line; sports contains the bookmaker line', () => {
    expect(categoryDeepGuards('real_estate')).toContain(REAL_ESTATE_DEEP_GUARD)
    expect(categoryDeepGuards('sports')).toContain(SPORTS_DEEP_GUARD)
    expect(leagueAnalystSystemPrompt('Price-path analyst', 'read the packet')).toContain(REAL_ESTATE_DEEP_GUARD)
    expect(leagueAnalystSystemPrompt('Price-path analyst', 'read the packet')).toContain(SPORTS_DEEP_GUARD)
    const ctx = readFileSync(join(ROOT, 'lib/league/deep-context.ts'), 'utf8')
    expect(ctx).toContain('categoryDeepGuards(round.category)')
  })
})

describe('write-path wiring', () => {
  it('orchestrator applies the sports scrub next to the analyst scrub before reasoning_snippet', () => {
    const src = readFileSync(join(ROOT, 'lib/league/orchestrator.ts'), 'utf8')
    const sportsAt = src.indexOf('visibleLeagueText(category, rawRationale)')
    const writeAt = src.indexOf('reasoning_snippet: rationale,')
    expect(sportsAt).toBeGreaterThan(0)
    expect(writeAt).toBeGreaterThan(sportsAt)
  })

  it('deep persist scrubs sports state before storage', () => {
    const src = readFileSync(join(ROOT, 'lib/league/deep-store.ts'), 'utf8')
    expect(src).toContain('scrubVisibleDeepState(opts.state)')
  })
})

describe('rationale translation scrubs source before any locale', () => {
  beforeEach(() => {
    mocks.runSingleAiProvider.mockReset()
  })

  it('skip-LLM Korean persist uses the scrubbed source — no bookmaker name', async () => {
    const { translateRoundRationales } = await import('../rationale-i18n')
    const writes: Array<{ translated_text: string; source_hash: string }> = []
    const result = await translateRoundRationales(
      [{ predictionId: 'pred-1', text: 'Pinnacle implied 58%, line -140. 시장 기준선이다.' }],
      'ko',
      {
        loadCached: async () => ({ rows: [], error: null }),
        upsert: async (rows) => {
          writes.push(...rows)
          return { error: null }
        },
      },
    )
    expect(mocks.runSingleAiProvider).not.toHaveBeenCalled()
    const stored = result.translations['pred-1'] ?? writes[0]?.translated_text ?? ''
    expect(stored).not.toMatch(/Pinnacle/i)
    expect(stored).not.toMatch(/-140/)
    expect(stored).toContain('58%')
    expect(stored).toMatch(/시장 기준선/)
  })

  it('LLM translation prompt receives scrubbed English source', async () => {
    mocks.runSingleAiProvider.mockResolvedValue({
      text: '[{"id":0,"text":"시장 기준선은 58%이다."}]',
      promptTokens: 10,
      completionTokens: 10,
      costUsd: 0,
      model: 'gemini-3.5-flash',
    })
    const { translateRoundRationales } = await import('../rationale-i18n')
    const result = await translateRoundRationales(
      [{ predictionId: 'pred-2', text: 'Pinnacle implied 58%, line -140' }],
      'ko',
      {
        loadCached: async () => ({ rows: [], error: null }),
        upsert: async () => ({ error: null }),
      },
    )
    expect(mocks.runSingleAiProvider).toHaveBeenCalled()
    const prompt = String(mocks.runSingleAiProvider.mock.calls[0]?.[0]?.prompt ?? '')
    expect(prompt).not.toMatch(/Pinnacle/i)
    expect(prompt).not.toMatch(/-140/)
    expect(prompt).toContain('58%')
    expect(result.translations['pred-2']).toBe('시장 기준선은 58%이다.')
    expect(result.translations['pred-2']).not.toMatch(/Pinnacle|DraftKings|Bet365/i)
  })
})
