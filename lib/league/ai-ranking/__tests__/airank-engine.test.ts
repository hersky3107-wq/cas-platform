import { describe, expect, it } from 'vitest'
import { visibleLeagueText } from '../../visible-disclosure'
import {
  AIRANK_OVERALL_CATEGORY,
  decodeAirankInstrument,
  encodeAirankInstrument,
  parseAirankInstrument,
  airankAttributionLine,
} from '../instrument'
import {
  firstSnapshotOnOrAfter,
  gradeAirankSnapshot,
  baseRateFromHistory,
  formatShrunkBaseRate,
  shrinkToward50,
  type SnapshotBrandRow,
  type SnapshotModelRow,
} from '../grade'
import { assembleAirankInjection, brandScoreGapLine } from '../packet'
import { scrubAirankDisclosure } from '../disclosure'
import { selfVendorFlags } from '../self-vendor'
import { mapVendorBrand, OTHER_VENDOR_BRAND } from '../brands'

function brand(brand: SnapshotBrandRow['brand'], model: string, rank: number, score: number | null = null): SnapshotBrandRow {
  return { brand, model, rank, score }
}

function model(name: string, brandName: SnapshotBrandRow['brand'], rank: number): SnapshotModelRow {
  return { model: name, brand: brandName, rank, score: null }
}

const DEADLINE = '2026-11-04'

describe('AIRANK codec', () => {
  it('round-trips each kind and reports overall for non-text arenas', () => {
    expect(AIRANK_OVERALL_CATEGORY).toBe('overall')
    const rank1 = encodeAirankInstrument({
      arena: 'text',
      category: 'overall',
      kind: 'brand_rank1',
      subject: 'OpenAI',
      deadlineYmd: DEADLINE,
      horizon: '1m',
    })
    expect(rank1).toBe('AIRANK:text:overall:brand_rank1:OpenAI:20261104')
    expect(decodeAirankInstrument(rank1)).toEqual({
      arena: 'text',
      category: 'overall',
      kind: 'brand_rank1',
      subject: 'OpenAI',
      deadlineYmd: DEADLINE,
    })

    const topn = encodeAirankInstrument({
      arena: 'text',
      category: 'coding',
      kind: 'brand_topn',
      subject: 'google',
      param: '5',
      deadlineYmd: DEADLINE,
    })
    expect(decodeAirankInstrument(topn)).toMatchObject({
      kind: 'brand_topn',
      subject: 'Google',
      param: '5',
    })

    const above = encodeAirankInstrument({
      arena: 'text_to_image',
      category: 'overall',
      kind: 'brand_above',
      subject: 'bfl',
      param: 'ideogram',
      deadlineYmd: DEADLINE,
    })
    expect(decodeAirankInstrument(above)).toMatchObject({
      arena: 'text_to_image',
      category: 'overall',
      kind: 'brand_above',
      subject: 'Black Forest Labs',
      param: 'Ideogram',
    })

    const camp = encodeAirankInstrument({
      arena: 'text',
      category: 'overall',
      kind: 'camp_topn',
      subject: 'china',
      param: '3',
      deadlineYmd: DEADLINE,
    })
    expect(decodeAirankInstrument(camp)).toMatchObject({
      kind: 'camp_topn',
      subject: 'china',
      param: '3',
    })

    const modelRank = encodeAirankInstrument({
      arena: 'search',
      category: 'overall',
      kind: 'model_rank1',
      subject: 'sonar',
      deadlineYmd: DEADLINE,
    })
    expect(decodeAirankInstrument(modelRank)).toMatchObject({
      arena: 'search',
      category: 'overall',
      kind: 'model_rank1',
      subject: 'sonar',
    })
  })

  it('rejects 1d, unknown arena/category, and N out of range', () => {
    const ok = 'AIRANK:text:overall:brand_rank1:OpenAI:20261104'
    expect(parseAirankInstrument(ok, '1d')).toEqual({ ok: false, reason: 'horizon_1d' })
    expect(parseAirankInstrument(ok, '2w')).toEqual({ ok: false, reason: 'bad_horizon' })
    expect(parseAirankInstrument('AIRANK:chess:overall:brand_rank1:OpenAI:20261104')).toEqual({
      ok: false,
      reason: 'unknown_arena',
    })
    expect(parseAirankInstrument('AIRANK:text:korean:brand_rank1:OpenAI:20261104')).toEqual({
      ok: false,
      reason: 'unknown_category',
    })
    expect(
      parseAirankInstrument('AIRANK:text:overall:brand_topn:OpenAI:1:20261104'),
    ).toEqual({ ok: false, reason: 'n_out_of_range' })
    expect(
      parseAirankInstrument('AIRANK:text:overall:brand_topn:OpenAI:11:20261104'),
    ).toEqual({ ok: false, reason: 'n_out_of_range' })
  })
})

describe('AIRANK grading', () => {
  const snap = {
    brands: [
      brand('Google', 'gemini-3', 1, 1450),
      brand('OpenAI', 'gpt-5', 2, 1430),
      brand('Anthropic', 'claude', 2, 1428),
    ],
    models: [model('gemini-3', 'Google', 1), model('gpt-5', 'OpenAI', 2), model('claude', 'Anthropic', 2)],
    publishDate: '2026-11-05',
  }

  it('grades each kind including absent, tie, VOID, and first snapshot on/after deadline', () => {
    const rank1 = decodeAirankInstrument('AIRANK:text:overall:brand_rank1:Google:20261104')!
    expect(gradeAirankSnapshot(rank1, snap).verdict).toBe('YES')
    expect(gradeAirankSnapshot(rank1, snap).direction).toBe('up')

    const openai = decodeAirankInstrument('AIRANK:text:overall:brand_rank1:OpenAI:20261104')!
    expect(gradeAirankSnapshot(openai, snap).verdict).toBe('NO')
    expect(gradeAirankSnapshot(openai, snap).direction).toBe('down')

    const absent = decodeAirankInstrument('AIRANK:text:overall:brand_rank1:xAI:20261104')!
    expect(gradeAirankSnapshot(absent, snap)).toMatchObject({ verdict: 'NO', direction: 'down' })

    const shared = gradeAirankSnapshot(rank1, {
      ...snap,
      brands: [brand('Google', 'gemini-3', 1), brand('OpenAI', 'gpt-5', 1)],
    })
    expect(shared.verdict).toBe('YES')

    const topn = decodeAirankInstrument('AIRANK:text:overall:brand_topn:OpenAI:3:20261104')!
    expect(gradeAirankSnapshot(topn, snap).verdict).toBe('YES')
    const topnMiss = decodeAirankInstrument('AIRANK:text:overall:brand_topn:xAI:3:20261104')!
    expect(gradeAirankSnapshot(topnMiss, snap).verdict).toBe('NO')

    const above = decodeAirankInstrument('AIRANK:text:overall:brand_above:Google:OpenAI:20261104')!
    expect(gradeAirankSnapshot(above, snap).verdict).toBe('YES')
    const tie = decodeAirankInstrument('AIRANK:text:overall:brand_above:OpenAI:Anthropic:20261104')!
    expect(gradeAirankSnapshot(tie, snap).verdict).toBe('NO')
    const subjectGone = decodeAirankInstrument('AIRANK:text:overall:brand_above:xAI:OpenAI:20261104')!
    expect(gradeAirankSnapshot(subjectGone, snap).verdict).toBe('NO')
    const paramGone = decodeAirankInstrument('AIRANK:text:overall:brand_above:OpenAI:xAI:20261104')!
    expect(gradeAirankSnapshot(paramGone, snap).verdict).toBe('YES')
    const bothGone = decodeAirankInstrument('AIRANK:text:overall:brand_above:xAI:Meta:20261104')!
    expect(gradeAirankSnapshot(bothGone, snap)).toMatchObject({ verdict: 'VOID', direction: null })

    const modelHit = decodeAirankInstrument('AIRANK:text:overall:model_rank1:GEMINI:20261104')!
    expect(gradeAirankSnapshot(modelHit, snap).verdict).toBe('YES')
    const modelMiss = decodeAirankInstrument('AIRANK:text:overall:model_rank1:gpt-5:20261104')!
    expect(gradeAirankSnapshot(modelMiss, snap).verdict).toBe('NO')

    expect(firstSnapshotOnOrAfter(['2026-11-03', '2026-11-05', '2026-11-12'], '2026-11-04')).toBe('2026-11-05')
    expect(firstSnapshotOnOrAfter(['2026-11-03', '2026-11-05'], '2026-11-04', '2026-11-06')).toBeNull()
    expect(firstSnapshotOnOrAfter(['2026-11-03', '2026-11-07'], '2026-11-04', '2026-11-06')).toBe('2026-11-07')
    expect(firstSnapshotOnOrAfter(['2026-10-01'], '2026-11-04')).toBeNull()
  })
})

describe('AIRANK packet + disclosure', () => {
  it('contains ranking, trend, base rate, attribution, and BOTH SIDES', () => {
    const parts = decodeAirankInstrument('AIRANK:text:overall:brand_rank1:OpenAI:20261104')!
    const now = [
      brand('Google', 'gemini-3', 1, 1450),
      brand('OpenAI', 'gpt-5', 2, 1430),
    ]
    const earlier = [brand('OpenAI', 'gpt-4', 1, 1400), brand('Google', 'gemini-2', 2, 1390)]
    const text = assembleAirankInjection({
      parts,
      horizon: '1m',
      asOfYmd: '2026-10-04',
      locale: 'ko',
      rankingsByDate: [
        { date: '2026-07-01', brands: earlier },
        { date: '2026-09-06', brands: earlier },
        { date: '2026-10-04', brands: now },
      ],
      news: [{ query: 'OpenAI AI model release announcement', summary: 'GPT-5 shipped' }],
    })
    expect(text).toContain('순위 데이터: LMArena (CC BY 4.0)')
    expect(text).toContain('1. Google — gemini-3')
    expect(text).toContain('2. OpenAI — gpt-5')
    expect(text).toContain('RANK TREND:')
    expect(text).toContain('OpenAI 4w:')
    expect(text).toContain('OpenAI 12w:')
    expect(text).toContain('BASE RATE')
    expect(text).toContain('NEWS (OpenAI AI model release announcement): GPT-5 shipped')
    expect(text).toContain('BOTH SIDES')
    expect(text).toMatch(/argues YES:/)
    expect(text).toMatch(/argues NO:/)
    expect(text).toContain('raw score gap:')
    expect(text).toContain('gap vs above')
    expect(text).toContain('gap vs below')
    expect(text).toContain('gap vs below (OpenAI): 20')
    expect(text).toContain('shrunk toward 50%')
    expect(text).toContain('windows=')
    expect(text).toContain('effective n=')
    expect(airankAttributionLine('ko')).toBe('순위 데이터: LMArena (CC BY 4.0)')
    expect(brandScoreGapLine(now[0], null, now[1])).toContain('gap vs below (OpenAI): 20')
  })

  it('uses overlapping horizon windows and shrinks small-n base rates toward 50%', () => {
    const parts = decodeAirankInstrument('AIRANK:text:overall:brand_rank1:OpenAI:20261104')!
    const openaiLead = [brand('OpenAI', 'gpt-4', 1, 1400), brand('Google', 'gemini-2', 2, 1390)]
    const googleLead = [brand('Google', 'gemini-3', 1, 1450), brand('OpenAI', 'gpt-5', 2, 1430)]
    const rates = baseRateFromHistory({
      parts,
      horizon: '1m',
      datedBrandRanks: [
        { date: '2026-01-01', brands: openaiLead },
        { date: '2026-02-01', brands: googleLead },
        { date: '2026-03-01', brands: googleLead },
      ],
    })
    // Daily step from 2026-01-01 through 2026-01-30 (last − 30d). Jan 1 window
    // has no later snapshot; Jan 2–30 = 29 overlapping 1m windows.
    expect(rates.nPairs).toBe(29)
    expect(rates.effectiveN).toBe(2)
    expect(rates.rank1Changes).toBe(29)
    expect(rates.subjectObserved).toBe(29)
    expect(rates.subjectHeld).toBe(0)
    expect(rates.rank1ChangeRawPct).toBe(100)
    expect(rates.rank1ChangeShrunkPct).toBe(52)
    expect(rates.holdRawPct).toBe(0)
    expect(rates.holdShrunkPct).toBe(48)

    const tiny = shrinkToward50(3, 3)
    expect(tiny.rawPct).toBe(100)
    expect(tiny.shrunkPct).toBe(52)
    const printed = formatShrunkBaseRate(3, 3)
    expect(printed).toContain('n=3, shrunk toward 50%')
    expect(printed).not.toMatch(/100%/)
    expect(formatShrunkBaseRate(0, 0)).toBe('none measured')

    const shortHistory = baseRateFromHistory({
      parts,
      horizon: '1m',
      datedBrandRanks: [
        { date: '2026-09-25', brands: openaiLead },
        { date: '2026-09-30', brands: openaiLead },
        { date: '2026-10-02', brands: openaiLead },
      ],
    })
    expect(shortHistory.nPairs).toBe(0)
    expect(formatShrunkBaseRate(shortHistory.subjectHeld, shortHistory.subjectObserved)).toBe('none measured')
  })

  it('scrubs Elo / score figures on ai_models cards and leaves other categories alone', () => {
    const dirty = 'Google leads at 1450 Elo with score 1,312. Elo 1440. score 1312. [self_vendor subject=1 param=0 brand=OpenAI]'
    expect(visibleLeagueText('ai_models', dirty)).not.toMatch(/1450/)
    expect(visibleLeagueText('ai_models', dirty)).not.toMatch(/1,312/)
    expect(visibleLeagueText('ai_models', dirty)).not.toMatch(/1312/)
    expect(visibleLeagueText('ai_models', dirty)).not.toMatch(/Elo/)
    expect(visibleLeagueText('ai_models', dirty)).not.toMatch(/self_vendor/)
    expect(visibleLeagueText('tech', dirty)).toContain('1450 Elo')
    expect(scrubAirankDisclosure('score 1,312')).toBeNull()
  })
})

describe('self-vendor analysis flag', () => {
  it('marks a seat when vendorBrand equals the subject or param brand', () => {
    const inst = encodeAirankInstrument({
      arena: 'text',
      category: 'overall',
      kind: 'brand_above',
      subject: 'OpenAI',
      param: 'Google',
      deadlineYmd: DEADLINE,
    })
    expect(selfVendorFlags({ model_id: 'gpt-6-astra', brand: 'OpenAI' }, inst)).toMatchObject({
      isSubjectVendor: true,
      isParamVendor: false,
    })
    expect(selfVendorFlags({ model_id: 'gemini-3.8-flash-high', brand: 'Google' }, inst)).toMatchObject({
      isSubjectVendor: false,
      isParamVendor: true,
    })
    expect(selfVendorFlags({ model_id: 'claude-fable-5.1-max', brand: 'Anthropic' }, inst)).toMatchObject({
      isSubjectVendor: false,
      isParamVendor: false,
    })
    const campInst = encodeAirankInstrument({
      arena: 'text',
      category: 'overall',
      kind: 'camp_rank1',
      subject: 'us',
      deadlineYmd: DEADLINE,
    })
    expect(selfVendorFlags({ model_id: 'gpt-6-astra', brand: 'OpenAI' }, campInst).isSubjectVendor).toBe(true)
    expect(selfVendorFlags({ model_id: 'deepseek-v4', brand: 'DeepSeek' }, campInst).isSubjectVendor).toBe(false)
  })
})

describe('aorizon stays unmapped', () => {
  it('reports aorizon as 기타', () => {
    const mapped = mapVendorBrand('aorizon', 'ao-1')
    expect(mapped.brand).toBe(OTHER_VENDOR_BRAND)
    expect(mapped.unmappedOrganization).toBe('aorizon')
  })
})
