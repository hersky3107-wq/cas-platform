import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  BRAND_TABLE_FIELDS,
  BRAND_TABLE_OTHER,
  aggregateBorda,
  brandTableDeadlineYmd,
  brandTableHeader,
  buildBrandTableView,
  candidateListFromRanking,
  currentBrandTableSlot,
  decodeBrandTableRanking,
  encodeBrandTableInstrument,
  encodeBrandTableRanking,
  extractBrandTableCandidates,
  extractBrandTableBaseline,
  gradeBrandTableRanking,
  mapActualBrandsToCandidates,
  parseBrandTableAnswer,
  parseBrandTablePick,
  planAirankTableSlots,
  thisWeekSundayKst,
  weekTableOpenPassed,
  monthTableOpenPassed,
  effectiveHistoryN,
  utcDaySpanInclusive,
} from '../ai-ranking/brand-table'
import { decodeAirankInstrument, parseAirankInstrument } from '../ai-ranking/instrument'
import { baseRateFromHistory, formatOverlappingBaseRate, type SnapshotBrandRow } from '../ai-ranking/grade'
import { parseVoidRoundArgs } from '../void-round-args'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrandTablePanel } from '../../../components/league/BrandTablePanel'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { brandTableCopy } from '../ai-ranking/brand-table-copy'
import { makeBrandTableContract } from '../ai-ranking/brand-table-prompts'

vi.mock('server-only', () => ({}))

function row(brand: SnapshotBrandRow['brand'], model: string, rank: number): SnapshotBrandRow {
  return { brand, model, rank, score: null }
}

const CANDIDATES = [
  'OpenAI',
  'Google',
  'Anthropic',
  'xAI',
  'DeepSeek',
  'Meta',
  'Alibaba/Qwen',
  'Moonshot',
  'MiniMax',
  'Mistral',
  'Zhipu/GLM',
  'Microsoft',
  BRAND_TABLE_OTHER,
]

describe('brand_table codec', () => {
  it('round-trips AIRANK:{arena}:{category}:brand_table:top5:{deadline}', () => {
    const instrument = encodeBrandTableInstrument(BRAND_TABLE_FIELDS[1], '2026-10-11')
    expect(instrument).toBe('AIRANK:text:coding:brand_table:top5:20261011')
    expect(decodeAirankInstrument(instrument)).toEqual({
      arena: 'text',
      category: 'coding',
      kind: 'brand_table',
      subject: 'top5',
      deadlineYmd: '2026-10-11',
    })
    expect(parseAirankInstrument(instrument).ok).toBe(true)
  })

  it('rejects brand_table without top5', () => {
    expect(parseAirankInstrument('AIRANK:text:coding:brand_table:openai:20261011')).toEqual({
      ok: false,
      reason: 'bad_subject',
    })
  })
})

describe('brand_table answer validation', () => {
  it('accepts five distinct candidates and a #1 probability', () => {
    const parsed = parseBrandTableAnswer(
      '{"ranking":["OpenAI","Google","Anthropic","xAI","DeepSeek"],"probability":62,"rationale":"Gap holds."}',
      CANDIDATES,
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.answer.ranking).toEqual(['OpenAI', 'Google', 'Anthropic', 'xAI', 'DeepSeek'])
      expect(parsed.answer.probability).toBe(62)
    }
  })

  it('rejects fewer than 5, duplicates, or off-list brands', () => {
    expect(
      parseBrandTableAnswer('{"ranking":["OpenAI","Google"],"probability":50}', CANDIDATES).ok,
    ).toBe(false)
    expect(
      parseBrandTableAnswer(
        '{"ranking":["OpenAI","Google","Anthropic","xAI","OpenAI"],"probability":50}',
        CANDIDATES,
      ).ok,
    ).toBe(false)
    expect(
      parseBrandTableAnswer(
        '{"ranking":["OpenAI","Google","Anthropic","xAI","UnknownLab"],"probability":50}',
        CANDIDATES,
      ).ok,
    ).toBe(false)
  })

  it('maps 기타·신규 aliases', () => {
    const parsed = parseBrandTableAnswer(
      '{"ranking":["OpenAI","Google","Anthropic","xAI","other_new"],"probability":40}',
      CANDIDATES,
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.answer.ranking[4]).toBe(BRAND_TABLE_OTHER)
  })

  it('contract parse fails closed when the list is invalid', () => {
    const contract = makeBrandTableContract(CANDIDATES)
    const bad = contract.parse('{"ranking":["OpenAI"],"probability":50}')
    expect(contract.validate(bad).ok).toBe(false)
    const good = contract.parse(
      '{"ranking":["OpenAI","Google","Anthropic","xAI","DeepSeek"],"probability":55,"rationale":"ok"}',
    )
    expect(contract.validate(good).ok).toBe(true)
  })
})

describe('Borda aggregation', () => {
  it('scores 5..1 and counts #1 votes', () => {
    const rows = aggregateBorda([
      ['OpenAI', 'Google', 'Anthropic', 'xAI', 'DeepSeek'],
      ['OpenAI', 'Anthropic', 'Google', 'xAI', 'DeepSeek'],
      ['Google', 'OpenAI', 'Anthropic', 'xAI', 'DeepSeek'],
    ])
    expect(rows[0].brand).toBe('OpenAI')
    expect(rows[0].firstVotes).toBe(2)
    expect(rows[0].points).toBe(5 + 5 + 4)
    expect(rows[1].brand).toBe('Google')
    expect(rows[1].firstVotes).toBe(1)
  })
})

describe('grading top1 / top3 / baseline', () => {
  it('scores top1 hit and top3 overlap', () => {
    const grade = gradeBrandTableRanking(
      ['OpenAI', 'Google', 'Anthropic', 'xAI', 'DeepSeek'],
      ['Google', 'OpenAI', 'xAI', 'Anthropic', 'Meta'],
    )
    expect(grade.top1Hit).toBe(false)
    expect(grade.top3Overlap).toBe(2)
  })

  it('maps new actual brands onto 기타·신규', () => {
    const mapped = mapActualBrandsToCandidates(['NewLab', 'OpenAI', 'Google', 'Anthropic', 'xAI'], CANDIDATES)
    expect(mapped[0]).toBe(BRAND_TABLE_OTHER)
    expect(gradeBrandTableRanking([BRAND_TABLE_OTHER, 'OpenAI', 'Google', 'Anthropic', 'xAI'], mapped).top1Hit).toBe(
      true,
    )
  })

  it('counts seats that beat the persistence baseline', () => {
    const actual = ['Google', 'OpenAI', 'Anthropic', 'xAI', 'DeepSeek']
    const baseline = gradeBrandTableRanking(['OpenAI', 'Google', 'Anthropic', 'xAI', 'DeepSeek'], actual)
    const better = gradeBrandTableRanking(['Google', 'OpenAI', 'Anthropic', 'xAI', 'DeepSeek'], actual)
    expect(better.bordaVsActual).toBeGreaterThan(baseline.bordaVsActual)
    expect(better.top1Hit).toBe(true)
    expect(baseline.top1Hit).toBe(false)
  })
})

describe('scheduler idempotency', () => {
  it('Monday after 09:00 KST yields 6 weekly + 6 monthly when the 1st has also passed', () => {
    const monday = new Date('2026-10-05T01:00:00.000Z') // 10:00 KST Monday Oct 5
    expect(weekTableOpenPassed(monday)).toBe(true)
    expect(monthTableOpenPassed(monday)).toBe(true)
    const slots = planAirankTableSlots(monday)
    expect(slots).toHaveLength(12)
    expect(new Set(slots.map((s) => s.cacheKey)).size).toBe(12)
    expect(slots.filter((s) => s.horizon === '1w')).toHaveLength(6)
    expect(slots.filter((s) => s.horizon === '1m')).toHaveLength(6)
    expect(thisWeekSundayKst(monday)).toBe('2026-10-11')
    expect(brandTableDeadlineYmd('1m', monday)).toBe('2026-10-31')
  })

  it('Sunday before Monday 09:00 does not open the next week 1w slots', () => {
    const sunday = new Date('2026-10-04T01:00:00.000Z') // Sunday 10:00 KST
    expect(weekTableOpenPassed(sunday)).toBe(true)
    expect(thisWeekSundayKst(sunday)).toBe('2026-10-04')
    const again = planAirankTableSlots(sunday)
    const keys = again.map((s) => s.cacheKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('current slot is stable for a field/period', () => {
    const a = currentBrandTableSlot('coding', '1w', new Date('2026-10-06T01:00:00.000Z'))
    const b = currentBrandTableSlot('coding', '1w', new Date('2026-10-07T01:00:00.000Z'))
    expect(a.instrument).toBe(b.instrument)
    expect(a.cacheKey).toBe(b.cacheKey)
  })
})

describe('UI table + headline', () => {
  it('renders the predicted table and localized headline', () => {
    const view = buildBrandTableView({
      officialRankings: [
        ['OpenAI', 'Google', 'Anthropic', 'xAI', 'DeepSeek'],
        ['OpenAI', 'Anthropic', 'Google', 'xAI', 'DeepSeek'],
      ],
      current: [
        row('OpenAI', 'gpt-5', 1),
        row('Google', 'gemini', 2),
        row('Anthropic', 'claude', 3),
        row('xAI', 'grok', 4),
        row('DeepSeek', 'v3', 5),
      ],
    })
    expect(view.headlineBrand).toBe('OpenAI')
    expect(view.headlineFirstVotes).toBe(2)
    const html = renderToStaticMarkup(
      createElement(BrandTablePanel, { view, locale: 'ko', graded: false }),
    )
    expect(html).toContain('AI 예상 순위표')
    expect(html).toContain('OpenAI')
    expect(html).toContain('data-testid="brand-table-headline"')
    expect(html).toContain('2개가')
  })
})

describe('effective-n shrinkage', () => {
  it('shrinks overlapping windows with floor(days/horizon)', () => {
    expect(utcDaySpanInclusive('2026-01-01', '2026-03-01')).toBe(60)
    expect(effectiveHistoryN(60, 30)).toBe(2)
    const parts = decodeAirankInstrument('AIRANK:text:overall:brand_rank1:OpenAI:20261104')!
    const openaiLead = [row('OpenAI', 'gpt-4', 1), row('Google', 'gemini-2', 2)]
    const googleLead = [row('Google', 'gemini-3', 1), row('OpenAI', 'gpt-5', 2)]
    const rates = baseRateFromHistory({
      parts,
      horizon: '1m',
      datedBrandRanks: [
        { date: '2026-01-01', brands: openaiLead },
        { date: '2026-02-01', brands: googleLead },
        { date: '2026-03-01', brands: googleLead },
      ],
    })
    expect(rates.nPairs).toBe(29)
    expect(rates.effectiveN).toBe(2)
    expect(rates.rank1ChangeRawPct).toBe(100)
    expect(rates.rank1ChangeShrunkPct).toBe(52)
    const printed = formatOverlappingBaseRate(rates.rank1Changes, rates.nPairs, rates.effectiveN)
    expect(printed).toContain('windows=29')
    expect(printed).toContain('effective n=2')
    expect(printed).toContain('shrunk toward 50%')
  })
})

describe('void script dry-run', () => {
  it('parses args and defaults to dry-run (no apply)', () => {
    const parsed = parseVoidRoundArgs(['--round', '11111111-1111-1111-1111-111111111111', '--reason', 'data_error'])
    expect(parsed).toEqual({
      roundId: '11111111-1111-1111-1111-111111111111',
      reason: 'data_error',
      apply: false,
    })
    const apply = parseVoidRoundArgs(['--round', '11111111-1111-1111-1111-111111111111', '--apply'])
    expect('apply' in apply && apply.apply).toBe(true)
    const src = readFileSync(join(__dirname, '../admin-void-round.ts'), 'utf8')
    const runAt = src.indexOf('export async function runVoidRound')
    const applyCall = src.indexOf('applyVoidRound(planned.plan)', runAt)
    const dryGuard = src.indexOf('if (!args.apply)', runAt)
    expect(dryGuard).toBeGreaterThan(runAt)
    expect(dryGuard).toBeLessThan(applyCall)
    expect(src).toMatch(/if \(!args\.apply\) return \{ ok: true, dryRun: true/)
  })
})

describe('copy in 8 locales', () => {
  it('has a field chip and headline template for every locale', () => {
    for (const loc of LEAGUE_LOCALES) {
      const c = brandTableCopy(loc)
      expect(c.sectionTitle.length).toBeGreaterThan(0)
      expect(c.fields.coding.length).toBeGreaterThan(0)
      expect(c.headline(12, 'OpenAI', 40)).toContain('OpenAI')
    }
  })
})

describe('packet candidate extract + ranking encode', () => {
  it('reads the CANDIDATES line and round-trips slugs', () => {
    const list = candidateListFromRanking([
      row('OpenAI', 'gpt', 1),
      row('Google', 'gem', 2),
      row('Anthropic', 'claude', 3),
    ])
    expect(list.at(-1)).toBe(BRAND_TABLE_OTHER)
    const encoded = encodeBrandTableRanking(['OpenAI', 'Google', BRAND_TABLE_OTHER])
    expect(decodeBrandTableRanking(encoded)).toEqual(['OpenAI', 'Google', BRAND_TABLE_OTHER])
    expect(
      extractBrandTableCandidates(`CANDIDATES (choose exactly 5 distinct, in rank order, from this list only): ${list.join(' | ')}`),
    ).toEqual(list)
    expect(
      extractBrandTableBaseline(
        `BASELINE TOP5 (persistence at open — current ranking if it held): ${list.slice(0, 3).join(' | ')}`,
      ),
    ).toEqual(list.slice(0, 3))
  })

  it('parses a #1-only extra pick', () => {
    const pick = parseBrandTablePick('{"pick":"Anthropic","probability":71}', CANDIDATES)
    expect(pick.ok).toBe(true)
    if (pick.ok) expect(pick.pick).toBe('Anthropic')
  })
})

describe('header', () => {
  it('uses field + period, never raw 1m', () => {
    const parts = decodeAirankInstrument('AIRANK:text:coding:brand_table:top5:20261011')!
    expect(brandTableHeader(parts, '1w', 'ko')).toBe('코딩 순위표 · 이번 주')
    expect(brandTableHeader(parts, '1m', 'en')).toContain('this month')
    expect(brandTableHeader(parts, '1m', 'en')).not.toContain('1m')
  })
})
