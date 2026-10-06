/**
 * Divination seat 사주 / 구성기학 chart (league layer).
 *
 * Oracle boundary: everything here lives under lib/league/extra. The oracle
 * module (lib/oracle/**, its 4-beat pipeline) is not modified — the last
 * block asserts the import boundary; the commit was also checked with
 * `git diff --stat HEAD -- lib/oracle` (empty).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelTile } from '../../../components/league/ModelTile'
import { readLeagueDivination } from '@/lib/oracle/league-divination/adapter'
import { createMemoryLeagueDivinationCache } from '@/lib/oracle/league-divination/cache'
import { MARKET_LANGUAGE_BAN } from '@/lib/oracle/league-divination/parse-reader'
import type { LeagueReaderCall } from '@/lib/oracle/league-divination/reader'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import type { CardModelPrediction } from '../card-types'
import {
  boardHits,
  directionOfStar,
  nineStarAt,
  pillarsAt,
  starAt,
  yearMonthPillars,
} from '../extra/divination-calendar'
import {
  appendChartToReaderPrompt,
  buildDivinationChart,
  chartAwareReaderCall,
  divinationChartPromptLines,
  kigakuChartForInstrument,
  sajuChart,
  type DivinationChartDeps,
} from '../extra/divination-chart'
import { divinationChartLine } from '../extra/divination-chart-copy'
import { parseDivinationChart, type DivinationChart } from '../extra/divination-chart-types'
import { kigakuSector, propertyRegionDirection } from '../extra/divination-direction'
import { ganzhiHangul } from '../extra/divination-ganzhi'
import {
  classifyEntity,
  clearSubjectBirthMemory,
  currentCeoId,
  defaultWikidataFetch,
  lookupSubjectBirth,
  parseRetryAfterMs,
  parseSubjectBirth,
  resolveSubjectBirth,
  WikidataHttpError,
  wikidataYearMonth,
  type SajuCategory,
  type SubjectBirth,
  type SubjectCacheStore,
  type WikidataEntity,
} from '../extra/divination-wikidata'
import { PROPERTY_REGIONS } from '../gateway/adapters/real-estate-regions'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'

const GREGORIAN = 'http://www.wikidata.org/entity/Q1985727'
const JULIAN = 'http://www.wikidata.org/entity/Q1985786'

function timeClaim(time: string, precision = 11, calendarmodel = GREGORIAN) {
  return { mainsnak: { snaktype: 'value', datavalue: { value: { time, precision, calendarmodel } } }, rank: 'normal' }
}

function itemClaim(id: string, extra: Record<string, unknown> = {}) {
  return { mainsnak: { snaktype: 'value', datavalue: { value: { id } } }, rank: 'normal', ...extra }
}

function entity(
  id: string,
  opts: { labels?: Record<string, string>; claims?: Record<string, unknown[]>; sitelinks?: number },
): WikidataEntity {
  return {
    id,
    labels: Object.fromEntries(Object.entries(opts.labels ?? {}).map(([lang, value]) => [lang, { value }])),
    claims: (opts.claims ?? {}) as WikidataEntity['claims'],
    sitelinks: Object.fromEntries(Array.from({ length: opts.sitelinks ?? 1 }, (_, i) => [`wiki${i}`, {}])),
  }
}

type Hit = { id: string; label: string; match?: { type: string; text: string }; aliases?: string[] }

function fakeWikidata(searches: Record<string, Hit[]>, entities: Record<string, WikidataEntity>) {
  const calls: string[] = []
  const fetchJson = vi.fn(async (url: string) => {
    calls.push(url)
    const u = new URL(url)
    if (u.searchParams.get('action') === 'wbsearchentities') {
      return { search: searches[u.searchParams.get('search') ?? ''] ?? [] }
    }
    const ids = (u.searchParams.get('ids') ?? '').split('|')
    return { entities: Object.fromEntries(ids.map((id) => [id, entities[id] ?? { id, missing: '' }])) }
  })
  return { fetchJson, calls }
}

const NVIDIA = entity('Q182477', {
  labels: { en: 'Nvidia', ko: '엔비디아' },
  claims: {
    P31: [itemClaim('Q891723')],
    P571: [timeClaim('+1993-04-05T00:00:00Z')],
    P169: [
      itemClaim('Q900', { qualifiers: { P582: [{ snaktype: 'value', datavalue: { value: { time: '+2001-01-01T00:00:00Z' } } }] } }),
      itemClaim('Q305177', { qualifiers: { P580: [{ snaktype: 'value', datavalue: { value: { time: '+1993-04-05T00:00:00Z' } } }] } }),
    ],
  },
  sitelinks: 120,
})
const JENSEN = entity('Q305177', {
  labels: { en: 'Jensen Huang', ko: '젠슨 황', ja: 'ジェンスン・フアン' },
  claims: { P31: [itemClaim('Q5')], P569: [timeClaim('+1963-02-17T00:00:00Z')] },
})

const NVIDIA_BIRTH: SubjectBirth = {
  qid: 'Q182477',
  kind: 'company',
  source: 'ceo_birth',
  yearMonth: '1963-02',
  labels: { en: 'Nvidia', ko: '엔비디아' },
  ceo: { qid: 'Q305177', labels: { en: 'Jensen Huang', ko: '젠슨 황', ja: 'ジェンスン・フアン' } },
}

describe('연주·월주 at 입춘 / 절기 boundaries', () => {
  it('turns the year and month at the 2024 입춘 instant (17:27 KST)', () => {
    expect(pillarsAt('2024-02-04T08:27:00Z')).toEqual({ year: '癸卯', month: '乙丑' })
    expect(pillarsAt('2024-02-04T08:28:00Z')).toEqual({ year: '甲辰', month: '丙寅' })
  })

  it('turns the month at 경칩 without touching the year', () => {
    expect(pillarsAt('2024-03-05T02:22:00Z')).toEqual({ year: '甲辰', month: '丙寅' })
    expect(pillarsAt('2024-03-05T02:23:30Z')).toEqual({ year: '甲辰', month: '丁卯' })
  })

  it('reads a birth/founding month at mid-month, so January stays in the previous 입춘 year', () => {
    expect(yearMonthPillars('2024-01')).toEqual({ year: '癸卯', month: '乙丑' })
    expect(yearMonthPillars('2024-02')).toEqual({ year: '甲辰', month: '丙寅' })
    expect(yearMonthPillars('1963-02')).toEqual({ year: '癸卯', month: '甲寅' })
    expect(yearMonthPillars('1970-01')).toEqual({ year: '己酉', month: '丁丑' })
    expect(yearMonthPillars('2024-13')).toBeNull()
  })

  it('renders hangul pillars', () => {
    expect(ganzhiHangul('甲辰')).toBe('갑진')
    expect(ganzhiHangul('丙寅')).toBe('병인')
    expect(ganzhiHangul('xx')).toBeNull()
  })
})

describe('구성기학 centre stars', () => {
  it('matches the standard 年盤 for known years (year turns at 입춘)', () => {
    expect(nineStarAt('2000-06-15T03:00:00Z')).toMatchObject({ qiYear: 2000, yearStar: 9 })
    expect(nineStarAt('2024-06-15T03:00:00Z')).toMatchObject({ qiYear: 2024, yearStar: 3 })
    expect(nineStarAt('2025-06-15T03:00:00Z')).toMatchObject({ qiYear: 2025, yearStar: 2 })
    expect(nineStarAt('2026-02-10T03:00:00Z')).toMatchObject({ qiYear: 2026, yearStar: 1 })
    expect(nineStarAt('2026-01-20T03:00:00Z')).toMatchObject({ qiYear: 2025, yearStar: 2, yearBranch: '巳' })
  })

  it('matches the standard 月盤 for known months', () => {
    // 子午卯酉 years: 寅月 八白 … 酉月 一白, 戌月 九紫
    expect(nineStarAt('2026-02-10T03:00:00Z')).toMatchObject({ monthStar: 8, monthBranch: '寅' })
    expect(nineStarAt('2026-09-15T03:00:00Z')).toMatchObject({ monthStar: 1, monthBranch: '酉' })
    expect(nineStarAt('2026-10-15T03:00:00Z')).toMatchObject({ monthStar: 9, monthBranch: '戌' })
    // 寅申巳亥 years: 丑月 九紫
    expect(nineStarAt('2026-01-20T03:00:00Z')).toMatchObject({ monthStar: 9, monthBranch: '丑' })
  })

  it('flies the board forward from the centre', () => {
    expect((['N', 'SW', 'E', 'SE', 'center', 'NW', 'W', 'NE', 'S'] as const).map((d) => starAt(5, d))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
    expect(starAt(1, 'S')).toBe(5)
    expect(starAt(1, 'N')).toBe(6)
    expect(starAt(1, 'SE')).toBe(9)
    expect(directionOfStar(1, 5)).toBe('S')
    expect(directionOfStar(9, 5)).toBe('N')
  })

  it('marks 오황살 / 암검살 / 세파 / 월파', () => {
    // 2026 年盤: 一白 centre, 五黄 south, 歳破 at 子 (north)
    expect(boardHits(1, '午', 'S', 'year')).toEqual(['gohwang'])
    expect(boardHits(1, '午', 'N', 'year')).toEqual(['amgeom', 'sepa'])
    expect(boardHits(1, '午', 'SE', 'year')).toEqual([])
    expect(boardHits(1, '午', 'center', 'year')).toEqual([])
    // 2026-10 月盤: 九紫 centre, 五黄 north, 月破 at 辰 (southeast)
    expect(boardHits(9, '戌', 'N', 'month')).toEqual(['gohwang'])
    expect(boardHits(9, '戌', 'S', 'month')).toEqual(['amgeom'])
    expect(boardHits(9, '戌', 'SE', 'month')).toEqual(['wolpa'])
    // 五黄 in the centre clears 五黄殺 / 暗剣殺
    expect(boardHits(5, '子', 'S', 'year')).toEqual(['sepa'])
    expect(boardHits(5, '子', 'N', 'year')).toEqual([])
  })
})

describe('region direction from the capital centre', () => {
  it('puts 강남구 southeast of 서울 중심', () => {
    const dir = propertyRegionDirection('KR', '11680')
    expect(dir).toMatchObject({ origin: 'seoul', direction: 'SE' })
    expect(dir!.bearing!).toBeGreaterThan(130)
    expect(dir!.bearing!).toBeLessThan(140)
  })

  it('reads national series, capitals and the centre district as 중궁', () => {
    for (const [country, code] of [
      ['KR', 'NAT'],
      ['KR', '11'],
      ['KR', '11140'],
      ['JP', '13'],
      ['UK', 'E12000007'],
      ['UK', 'E09000033'],
      ['US', 'WDXRNSA'],
      ['US', 'CSUSHPINSA'],
      ['AU', 'CBR'],
    ] as const) {
      expect(propertyRegionDirection(country, code)?.direction, `${country}:${code}`).toBe('center')
    }
  })

  it('measures each country from its own capital', () => {
    expect(propertyRegionDirection('KR', '11110')?.direction).toBe('N')
    expect(propertyRegionDirection('KR', '28')?.direction).toBe('SW')
    expect(propertyRegionDirection('KR', '26')?.direction).toBe('SE')
    expect(propertyRegionDirection('JP', '27')).toMatchObject({ origin: 'tokyo', direction: 'W' })
    expect(propertyRegionDirection('UK', 'E09000007')).toMatchObject({ origin: 'london', direction: 'NW' })
    expect(propertyRegionDirection('US', 'LXXRNSA')).toMatchObject({ origin: 'washington', direction: 'W' })
    expect(propertyRegionDirection('AU', 'SYD')).toMatchObject({ origin: 'canberra', direction: 'NE' })
  })

  it('covers every housing region and nothing else', () => {
    const missing = PROPERTY_REGIONS.filter((r) => !propertyRegionDirection(r.country, r.code))
    expect(missing.map((r) => `${r.country}:${r.code}`)).toEqual([])
    expect(propertyRegionDirection('KR', '99999')).toBeNull()
  })

  it('uses 30° cardinal / 60° diagonal sectors', () => {
    expect(kigakuSector(14.9)).toBe('N')
    expect(kigakuSector(15)).toBe('NE')
    expect(kigakuSector(74.9)).toBe('NE')
    expect(kigakuSector(75)).toBe('E')
    expect(kigakuSector(105)).toBe('SE')
    expect(kigakuSector(195)).toBe('SW')
    expect(kigakuSector(285)).toBe('NW')
    expect(kigakuSector(345)).toBe('N')
  })
})

describe('Wikidata subject lookup', () => {
  it('person → date of birth', async () => {
    const { fetchJson, calls } = fakeWikidata(
      { 'Keisha Lance Bottoms': [{ id: 'Q6384962', label: 'Keisha Lance Bottoms' }] },
      {
        Q6384962: entity('Q6384962', {
          labels: { en: 'Keisha Lance Bottoms' },
          claims: { P31: [itemClaim('Q5')], P569: [timeClaim('+1970-01-18T00:00:00Z')] },
        }),
      },
    )
    const result = await lookupSubjectBirth('Keisha Lance Bottoms', 'politics_election', fetchJson)
    expect(result.reason).toBe('ok')
    expect(result.birth).toMatchObject({ qid: 'Q6384962', kind: 'person', source: 'birth', yearMonth: '1970-01', ceo: null })
    expect(new URL(calls[0]).searchParams.get('language')).toBe('en')
  })

  it('political party → founding date (Korean search)', async () => {
    const { fetchJson, calls } = fakeWikidata(
      { 더불어민주당: [{ id: 'Q20900155', label: '더불어민주당' }] },
      {
        Q20900155: entity('Q20900155', {
          labels: { ko: '더불어민주당', en: 'Democratic Party of Korea' },
          claims: { P31: [itemClaim('Q7278')], P571: [timeClaim('+2014-03-26T00:00:00Z')] },
        }),
      },
    )
    const result = await lookupSubjectBirth('더불어민주당', 'politics_election', fetchJson)
    expect(result.birth).toMatchObject({ kind: 'party', source: 'inception', yearMonth: '2014-03' })
    expect(new URL(calls[0]).searchParams.get('language')).toBe('ko')
  })

  it('reads a party by ideology + inception when its class is a subclass', () => {
    const party = entity('Q1', {
      claims: { P31: [itemClaim('Q99999')], P571: [timeClaim('+1828-01-08T00:00:00Z')], P1142: [itemClaim('Q2')] },
    })
    expect(classifyEntity(party)).toBe('party')
  })

  it('company → current CEO date of birth (P169 → P569)', async () => {
    const { fetchJson, calls } = fakeWikidata(
      { NVIDIA: [{ id: 'Q182477', label: 'Nvidia' }] },
      { Q182477: NVIDIA, Q305177: JENSEN },
    )
    expect(currentCeoId(NVIDIA)).toBe('Q305177')
    const result = await lookupSubjectBirth('NVIDIA', 'tech', fetchJson)
    expect(result.birth).toEqual(NVIDIA_BIRTH)
    expect(calls).toHaveLength(3)
  })

  it('company falls back to inception with no CEO, an ended CEO, or a CEO without a birth month', async () => {
    const samsung = entity('Q20718', {
      labels: { en: 'Samsung' },
      claims: { P31: [itemClaim('Q778575')], P571: [timeClaim('+1938-03-01T00:00:00Z')] },
    })
    const ended = entity('Q20718', {
      labels: { en: 'Samsung' },
      claims: {
        P31: [itemClaim('Q778575')],
        P571: [timeClaim('+1938-03-01T00:00:00Z')],
        P169: [itemClaim('Q7', { qualifiers: { P582: [{ snaktype: 'value', datavalue: { value: { time: '+2020-01-01T00:00:00Z' } } }] } })],
      },
    })
    const yearOnlyCeo = entity('Q20718', {
      labels: { en: 'Samsung' },
      claims: { P31: [itemClaim('Q778575')], P571: [timeClaim('+1938-03-01T00:00:00Z')], P169: [itemClaim('Q8')] },
    })
    const ceo = entity('Q8', { claims: { P31: [itemClaim('Q5')], P569: [timeClaim('+1968-00-00T00:00:00Z', 9)] } })
    for (const company of [samsung, ended, yearOnlyCeo]) {
      const { fetchJson } = fakeWikidata({ Samsung: [{ id: 'Q20718', label: 'Samsung' }] }, { Q20718: company, Q8: ceo })
      const result = await lookupSubjectBirth('Samsung', 'tech', fetchJson)
      expect(result.birth).toMatchObject({ kind: 'company', source: 'inception', yearMonth: '1938-03', ceo: null })
    }
    expect(currentCeoId(ended)).toBeNull()
  })

  it('prefers a label match, then an alias match (Apple the fruit vs Apple Inc.)', async () => {
    const { fetchJson } = fakeWikidata(
      {
        Apple: [
          { id: 'Q89', label: 'apple' },
          { id: 'Q312', label: 'Apple Inc.', match: { type: 'alias', text: 'Apple' } },
        ],
      },
      {
        Q89: entity('Q89', { labels: { en: 'apple' }, claims: { P31: [itemClaim('Q1364')] } }),
        Q312: entity('Q312', {
          labels: { en: 'Apple Inc.' },
          claims: { P31: [itemClaim('Q4830453')], P571: [timeClaim('+1976-04-01T00:00:00Z')] },
        }),
      },
    )
    const result = await lookupSubjectBirth('Apple', 'tech', fetchJson)
    expect(result.birth).toMatchObject({ qid: 'Q312', source: 'inception', yearMonth: '1976-04' })
  })

  it('skips an ambiguous name unless one entity clearly dominates', async () => {
    const person = (id: string, sitelinks: number, born: string) =>
      entity(id, { labels: { ko: '김민석' }, claims: { P31: [itemClaim('Q5')], P569: [timeClaim(born)] }, sitelinks })
    const hits = { 김민석: [{ id: 'Q1', label: '김민석' }, { id: 'Q2', label: '김민석' }] }
    const close = fakeWikidata(hits, { Q1: person('Q1', 5, '+1964-05-29T00:00:00Z'), Q2: person('Q2', 4, '+1999-01-01T00:00:00Z') })
    expect(await lookupSubjectBirth('김민석', 'politics_election', close.fetchJson)).toEqual({ birth: null, reason: 'ambiguous' })
    const dominant = fakeWikidata(hits, { Q1: person('Q1', 30, '+1964-05-29T00:00:00Z'), Q2: person('Q2', 4, '+1999-01-01T00:00:00Z') })
    const picked = await lookupSubjectBirth('김민석', 'politics_election', dominant.fetchJson)
    expect(picked.birth).toMatchObject({ qid: 'Q1', yearMonth: '1964-05' })
  })

  it('returns not_found / no_date without guessing', async () => {
    const none = fakeWikidata({ 치이카와: [{ id: 'Q5', label: '치이카와 극장판' }] }, {})
    expect(await lookupSubjectBirth('치이카와', 'entertainment', none.fetchJson)).toEqual({ birth: null, reason: 'not_found' })
    expect(none.calls).toHaveLength(1)

    const yearOnly = fakeWikidata(
      { Someone: [{ id: 'Q3', label: 'Someone' }] },
      { Q3: entity('Q3', { claims: { P31: [itemClaim('Q5')], P569: [timeClaim('+1950-00-00T00:00:00Z', 9)] } }) },
    )
    expect((await lookupSubjectBirth('Someone', 'politics_election', yearOnly.fetchJson)).reason).toBe('no_date')

    const wrongKind = fakeWikidata({ NVIDIA: [{ id: 'Q182477', label: 'Nvidia' }] }, { Q182477: NVIDIA })
    expect((await lookupSubjectBirth('NVIDIA', 'politics_election', wrongKind.fetchJson)).reason).toBe('no_date')
  })

  it('parses month precision only, Gregorian only', () => {
    const snak = (time: string, precision: number, calendarmodel = GREGORIAN) => ({
      snaktype: 'value',
      datavalue: { value: { time, precision, calendarmodel } },
    })
    expect(wikidataYearMonth(snak('+1963-02-17T00:00:00Z', 11))).toBe('1963-02')
    expect(wikidataYearMonth(snak('+1963-02-00T00:00:00Z', 10))).toBe('1963-02')
    expect(wikidataYearMonth(snak('+1963-00-00T00:00:00Z', 9))).toBeNull()
    expect(wikidataYearMonth(snak('+1700-02-17T00:00:00Z', 11, JULIAN))).toBeNull()
    expect(wikidataYearMonth({ snaktype: 'somevalue' })).toBeNull()
  })

  describe('per-subject cache', () => {
    beforeEach(() => clearSubjectBirthMemory())

    it('looks a subject up once, then serves memory', async () => {
      const { fetchJson } = fakeWikidata({ NVIDIA: [{ id: 'Q182477', label: 'Nvidia' }] }, { Q182477: NVIDIA, Q305177: JENSEN })
      const first = await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson })
      const second = await resolveSubjectBirth('Nvidia', 'tech', { fetchJson })
      expect(first).toEqual(NVIDIA_BIRTH)
      expect(second).toEqual(NVIDIA_BIRTH)
      expect(fetchJson).toHaveBeenCalledTimes(3)
    })

    it('serves a fresh stored row, refreshes a stale one, and writes back', async () => {
      const now = Date.parse('2026-10-06T00:00:00Z')
      const put = vi.fn(async () => undefined)
      const freshStore: SubjectCacheStore = {
        get: async () => ({ value: NVIDIA_BIRTH, fetchedAt: '2026-10-01T00:00:00Z' }),
        put,
      }
      const { fetchJson } = fakeWikidata({ NVIDIA: [{ id: 'Q182477', label: 'Nvidia' }] }, { Q182477: NVIDIA, Q305177: JENSEN })
      expect(await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson, store: freshStore, now: () => now })).toEqual(NVIDIA_BIRTH)
      expect(fetchJson).not.toHaveBeenCalled()

      clearSubjectBirthMemory()
      const staleStore: SubjectCacheStore = {
        get: async () => ({ value: null, fetchedAt: '2026-09-01T00:00:00Z' }),
        put,
      }
      expect(await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson, store: staleStore, now: () => now })).toEqual(NVIDIA_BIRTH)
      expect(fetchJson).toHaveBeenCalled()
      expect(put).toHaveBeenCalledWith('tech:nvidia', 'NVIDIA', NVIDIA_BIRTH)
    })

    it('does not cache a network failure, but does cache a miss', async () => {
      const failing = vi.fn(async () => {
        throw new Error('offline')
      })
      expect(await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson: failing })).toBeNull()
      const { fetchJson } = fakeWikidata({ NVIDIA: [{ id: 'Q182477', label: 'Nvidia' }] }, { Q182477: NVIDIA, Q305177: JENSEN })
      expect(await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson })).toEqual(NVIDIA_BIRTH)

      const miss = fakeWikidata({}, {})
      expect(await resolveSubjectBirth('Nobody', 'tech', { fetchJson: miss.fetchJson })).toBeNull()
      expect(await resolveSubjectBirth('Nobody', 'tech', { fetchJson: miss.fetchJson })).toBeNull()
      expect(miss.fetchJson).toHaveBeenCalledTimes(1)
    })

    it('gives up inside the time budget', async () => {
      const slow = vi.fn(() => new Promise<unknown>(() => undefined))
      expect(await resolveSubjectBirth('Slow', 'tech', { fetchJson: slow, budgetMs: 20 })).toBeNull()
    })

    it('retries a 429 once after Retry-After and still reaches the CEO', async () => {
      const wiki = fakeWikidata({ NVIDIA: [{ id: 'Q182477', label: 'Nvidia' }] }, { Q182477: NVIDIA, Q305177: JENSEN })
      let limited = true
      const fetchJson = vi.fn(async (url: string) => {
        if (limited && url.includes('ids=Q305177')) {
          limited = false
          throw new WikidataHttpError(429, 1_000)
        }
        return wiki.fetchJson(url)
      })
      const sleep = vi.fn(async (_ms: number) => undefined)
      const put = vi.fn(async () => undefined)
      const store: SubjectCacheStore = { get: async () => null, put }
      expect(await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson, sleep, store })).toEqual(NVIDIA_BIRTH)
      expect(sleep).toHaveBeenCalledWith(1_000)
      expect(fetchJson).toHaveBeenCalledTimes(4)
      expect(put).toHaveBeenCalledWith('tech:nvidia', 'NVIDIA', NVIDIA_BIRTH)
    })

    it('does not cache a 429 that persists, logs it, and tries again next time', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const limited = vi.fn(async () => {
          throw new WikidataHttpError(429, 500)
        })
        const put = vi.fn(async () => undefined)
        const sleep = vi.fn(async () => undefined)
        expect(await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson: limited, sleep, store: { get: async () => null, put } })).toBeNull()
        expect(limited).toHaveBeenCalledTimes(2)
        expect(put).not.toHaveBeenCalled()
        expect(warn.mock.calls.some(([line]) => /tech:nvidia.*wikidata 429/.test(String(line)))).toBe(true)
        const { fetchJson } = fakeWikidata({ NVIDIA: [{ id: 'Q182477', label: 'Nvidia' }] }, { Q182477: NVIDIA, Q305177: JENSEN })
        expect(await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson })).toEqual(NVIDIA_BIRTH)
      } finally {
        warn.mockRestore()
      }
    })

    it('skips the retry when the wait would overrun the budget', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const limited = vi.fn(async () => {
          throw new WikidataHttpError(503, 60_000)
        })
        const sleep = vi.fn(async () => undefined)
        expect(await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson: limited, sleep, budgetMs: 2_000 })).toBeNull()
        expect(limited).toHaveBeenCalledTimes(1)
        expect(sleep).not.toHaveBeenCalled()
      } finally {
        warn.mockRestore()
      }
    })

    it('shares one lookup between seats asking for the same subject at once', async () => {
      const { fetchJson } = fakeWikidata({ NVIDIA: [{ id: 'Q182477', label: 'Nvidia' }] }, { Q182477: NVIDIA, Q305177: JENSEN })
      const [a, b] = await Promise.all([
        resolveSubjectBirth('NVIDIA', 'tech', { fetchJson }),
        resolveSubjectBirth('Nvidia', 'tech', { fetchJson }),
      ])
      expect(a).toEqual(NVIDIA_BIRTH)
      expect(b).toEqual(NVIDIA_BIRTH)
      expect(fetchJson).toHaveBeenCalledTimes(3)
    })

    it('falls back to a stale stored hit while Wikidata is unavailable', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const store: SubjectCacheStore = {
          get: async () => ({ value: NVIDIA_BIRTH, fetchedAt: '2026-01-01T00:00:00Z' }),
          put: vi.fn(async () => undefined),
        }
        const failing = vi.fn(async () => {
          throw new Error('offline')
        })
        const now = () => Date.parse('2026-10-06T00:00:00Z')
        expect(await resolveSubjectBirth('NVIDIA', 'tech', { fetchJson: failing, store, now })).toEqual(NVIDIA_BIRTH)
        expect(store.put).not.toHaveBeenCalled()
      } finally {
        warn.mockRestore()
      }
    })

    it('reads Retry-After and identifies itself with a contact in the User-Agent', async () => {
      expect(parseRetryAfterMs('2')).toBe(2_000)
      expect(parseRetryAfterMs('Tue, 06 Oct 2026 13:00:05 GMT', Date.parse('2026-10-06T13:00:00Z'))).toBe(5_000)
      expect(parseRetryAfterMs(null)).toBeNull()
      const seen: Headers[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          seen.push(new Headers(init?.headers))
          return new Response('Too many requests', { status: 429, headers: { 'retry-after': '3' } })
        }),
      )
      try {
        await expect(defaultWikidataFetch('https://www.wikidata.org/w/api.php?action=wbsearchentities')).rejects.toMatchObject({
          status: 429,
          retryAfterMs: 3_000,
        })
      } finally {
        vi.unstubAllGlobals()
      }
      expect(seen[0]?.get('user-agent')).toMatch(/^CasPlatformLeague\/1\.0 \((https?:\/\/\S+|[^@\s]+@\S+)\)/)
    })

    it('round-trips a stored row and rejects malformed ones', () => {
      expect(parseSubjectBirth(JSON.parse(JSON.stringify(NVIDIA_BIRTH)))).toEqual(NVIDIA_BIRTH)
      expect(parseSubjectBirth(null)).toBeNull()
      expect(parseSubjectBirth({ ...NVIDIA_BIRTH, yearMonth: '1963' })).toBeNull()
    })
  })
})

function round(over: Partial<Parameters<typeof buildDivinationChart>[0]> = {}) {
  return {
    category: 'tech',
    instrument: 'TECH:OPEN:nvidia:announce:새_gpu:20261231:official_newsroom',
    subject_label: 'NVIDIA',
    resolves_at: '2026-12-31T23:59:59.999Z',
    opened_at: '2026-10-05T05:57:47.805Z',
    created_at: null,
    ...over,
  }
}

function deps(birth: SubjectBirth | null) {
  const resolveSubject = vi.fn(async (_name: string, _category: SajuCategory) => birth)
  return { resolveSubject } satisfies DivinationChartDeps
}

describe('divination chart for a round', () => {
  it('tech company → 사주 of the current CEO plus the period pillars', async () => {
    const d = deps(NVIDIA_BIRTH)
    const chart = await buildDivinationChart(round(), d)
    expect(d.resolveSubject).toHaveBeenCalledWith('NVIDIA', 'tech')
    expect(chart).toMatchObject({
      kind: 'saju',
      pillars: { year: '癸卯', month: '甲寅' },
      period: { yearMonth: '2027-01', year: '丙午', month: '庚子' },
    })
    expect(divinationChartPromptLines(chart!)).toEqual([
      '대상 사주: 젠슨 황(현 CEO) 계묘년 갑인월 (출생 1963-02)',
      '기간 사주: 병오년 경자월 (판정 시점 2027-01)',
      '위 줄은 색채 참고용입니다. CODE VERDICT를 바꾸지 말고, 언급한다면 한 줄 이내로 짧게 쓰십시오.',
    ])
  })

  it('politics and entertainment use their own subjects; founding reads 창립', async () => {
    const party: SubjectBirth = { qid: 'Q1', kind: 'party', source: 'inception', yearMonth: '2014-03', labels: {}, ceo: null }
    const chart = await buildDivinationChart(round({ category: 'politics_election', subject_label: '더불어민주당' }), deps(party))
    expect(divinationChartPromptLines(chart!)[0]).toBe('대상 사주: 갑오년 정묘월 (창립 2014-03)')
    const singer: SubjectBirth = { qid: 'Q2', kind: 'person', source: 'birth', yearMonth: '1970-01', labels: {}, ceo: null }
    const show = await buildDivinationChart(round({ category: 'entertainment_awards', subject_label: 'Someone' }), deps(singer))
    expect(divinationChartPromptLines(show!)[0]).toBe('대상 사주: 기유년 정축월 (출생 1970-01)')
  })

  it('real estate → 구성기학 for the reference month, no Wikidata call', async () => {
    const d = deps(NVIDIA_BIRTH)
    const chart = await buildDivinationChart(
      round({ category: 'real_estate', instrument: 'PROPERTY:KR:11680:apt_sale_mom:2026-09', subject_label: '강남구' }),
      d,
    )
    expect(d.resolveSubject).not.toHaveBeenCalled()
    expect(chart).toEqual({
      kind: 'kigaku',
      period: '2026-09',
      qiYear: 2026,
      origin: 'seoul',
      region: { country: 'KR', code: '11680', nameKo: '강남구', nameEn: 'Gangnam-gu' },
      direction: 'SE',
      year: { center: 1, star: 9, branch: '午', hits: [] },
      month: { center: 1, star: 9, branch: '酉', hits: [] },
      clear: true,
    })
    expect(divinationChartPromptLines(chart!).slice(0, 2)).toEqual([
      '구성기학 (기간 2026-09): 연반 중궁 일백수성, 월반 중궁 일백수성',
      '대상 방위: 강남구 — 서울 중심에서 동남방. 연반 구자화성, 월반 구자화성. 해당 살 없음',
    ])
  })

  it('names the 殺 a direction falls under', () => {
    const chart = kigakuChartForInstrument('PROPERTY:KR:26350:apt_sale_mom:2026-10')!
    expect(chart.month.hits).toEqual(['wolpa'])
    expect(chart.clear).toBe(false)
    expect(divinationChartPromptLines(chart)[1]).toContain('해당 살: 월반 월파(辰)')
    const tokyo = kigakuChartForInstrument('PROPERTY:JP:13:hpi_mom:2026-07')!
    expect(divinationChartPromptLines(tokyo)[1]).toBe('대상 방위: 도쿄도 — 도쿄 중심 그 자리(중궁). 방위 살 없음')
  })

  it('skips other categories, missing subjects and unknown names', async () => {
    const d = deps(NVIDIA_BIRTH)
    expect(await buildDivinationChart(round({ category: 'stocks', subject_label: 'Samsung' }), d)).toBeNull()
    expect(await buildDivinationChart(round({ subject_label: null }), d)).toBeNull()
    expect(d.resolveSubject).not.toHaveBeenCalled()
    expect(await buildDivinationChart(round(), deps(null))).toBeNull()
    expect(await buildDivinationChart(round({ category: 'real_estate', instrument: 'PROPERTY:KR:99999:apt_sale_mom:2026-09' }), d)).toBeNull()
  })

  it('keeps market words and verdict words out of the prompt lines', () => {
    const charts: DivinationChart[] = [
      sajuChart(NVIDIA_BIRTH, '2026-12-31T23:59:59.999Z')!,
      kigakuChartForInstrument('PROPERTY:KR:26350:apt_sale_mom:2026-10')!,
      kigakuChartForInstrument('PROPERTY:US:LXXRNSA:hpi_mom:2026-07')!,
    ]
    for (const chart of charts) {
      const text = divinationChartPromptLines(chart).join('\n').toLowerCase()
      for (const word of MARKET_LANGUAGE_BAN) expect(text, word).not.toContain(word.toLowerCase())
      for (const word of ['상승', '하락', '길한', '흉한', '유리', '불리']) expect(text, word).not.toContain(word)
    }
  })
})

describe('reader prompt injection (oracle adapter unchanged)', () => {
  it('puts the lines just before the closing instruction', () => {
    expect(appendChartToReaderPrompt('A\nB\nWrite exactly 4 or 5 Korean lines', ['X', 'Y'])).toBe(
      'A\nB\nX\nY\nWrite exactly 4 or 5 Korean lines',
    )
    expect(appendChartToReaderPrompt('A\nB', ['X'])).toBe('A\nB\nX')
    expect(appendChartToReaderPrompt('A', [])).toBe('A')
  })

  it('feeds the chart into the oracle reader without changing the code verdict', async () => {
    const input = {
      proposition: 'NVIDIA, 2026-12-31까지 새 gpu를 발표할까?',
      propositionType: 'pick_one' as const,
      category: 'tech' as const,
      subjectName: 'NVIDIA',
      firstViewedAt: '2026-12-31T23:59:59.999Z',
      roundId: 'div-chart-e2e',
    }
    const lines = divinationChartPromptLines(sajuChart(NVIDIA_BIRTH, input.firstViewedAt)!)
    const seen: string[] = []
    const call: LeagueReaderCall = async (args) => {
      seen.push(args.userPrompt)
      return { text: null }
    }
    const plain = await readLeagueDivination(input, { cache: createMemoryLeagueDivinationCache(), reader: call })
    const withChart = await readLeagueDivination(input, {
      cache: createMemoryLeagueDivinationCache(),
      reader: chartAwareReaderCall(lines, call),
    })

    const prompt = seen[seen.length - 1].split('\n')
    const at = prompt.indexOf(lines[0])
    expect(at).toBeGreaterThan(0)
    expect(prompt.slice(at, at + lines.length)).toEqual(lines)
    expect(prompt[at + lines.length]).toMatch(/^Write exactly/)
    expect(seen[0]).not.toContain('대상 사주')

    expect(withChart.verdict).toBe(plain.verdict)
    expect(withChart.pick).toBe(plain.pick)
    expect(withChart.confidence).toBe(plain.confidence)
    expect(withChart.votedCount).toBe(plain.votedCount)
  })
})

const KIGAKU_GANGNAM = kigakuChartForInstrument('PROPERTY:KR:11680:apt_sale_mom:2026-09')!
const SAJU_PLAIN = sajuChart(
  { qid: 'Q1', kind: 'person', source: 'birth', yearMonth: '2024-02', labels: {}, ceo: null },
  '2026-10-06T00:00:00Z',
)!
const SAJU_CEO = sajuChart(NVIDIA_BIRTH, '2026-10-06T00:00:00Z')!

describe('tile line copy (8 locales)', () => {
  it('reads like the spec in Korean', () => {
    expect(divinationChartLine('ko', SAJU_PLAIN)).toBe('사주: 갑진년 병인월')
    expect(divinationChartLine('ko', SAJU_CEO)).toBe('사주: 젠슨 황 계묘년 갑인월')
    expect(divinationChartLine('ko', KIGAKU_GANGNAM)).toBe('구성기학: 2026년 중궁 일백수성 · 동남방')
    expect(divinationChartLine('ko', null)).toBeNull()
  })

  it('has a line in every locale, with the CEO name in that locale when Wikidata has it', () => {
    expect(divinationChartLine('ja', SAJU_PLAIN)).toBe('四柱: 甲辰年 丙寅月')
    expect(divinationChartLine('ja', SAJU_CEO)).toBe('四柱: ジェンスン・フアン 癸卯年 甲寅月')
    expect(divinationChartLine('en', SAJU_CEO)).toBe('Saju: Jensen Huang · 癸卯 year · 甲寅 month')
    expect(divinationChartLine('ja', KIGAKU_GANGNAM)).toBe('九星気学: 2026年 中宮 一白水星 · 南東')
    expect(divinationChartLine('zh-TW', KIGAKU_GANGNAM)).toBe('九星氣學：2026年 中宮 一白水星 · 東南方')
    for (const chart of [SAJU_PLAIN, SAJU_CEO, KIGAKU_GANGNAM]) {
      const lines = LEAGUE_LOCALES.map((locale) => divinationChartLine(locale, chart))
      expect(lines.every((line) => typeof line === 'string' && line.length > 0)).toBe(true)
      expect(new Set(lines).size).toBe(LEAGUE_LOCALES.length)
    }
  })
})

describe('stored chart → card → tile', () => {
  const cardRound: RoundRow = {
    id: 'round-div',
    proposition_text: '[부동산원 2026-10-15 공표분, 기준월 2026-09] 강남구 아파트 매매가격지수 전월대비 상승?',
    category: 'real_estate',
    color_bucket: 'yellow',
    instrument: 'PROPERTY:KR:11680:apt_sale_mom:2026-09',
    horizon: '1m',
    resolution_rule: 'official print',
    resolves_at: '2026-10-15T00:00:00.000Z',
    opened_at: '2026-09-28T09:58:18.450Z',
    actual_outcome: null,
    resolved_at: null,
  }
  const row = (over: Partial<PredictionRow>): PredictionRow => ({
    model_id: 'divination',
    brand: '🔮 점술',
    camp: 'other',
    league_tier: 'extra',
    predicted_direction: 'yes',
    predicted_value: 38,
    reasoning_snippet: '본괘는 길한 흐름입니다.',
    is_correct: null,
    cost_usd: 0.003,
    predicted_at: '2026-09-28T10:00:00.000Z',
    ...over,
  })

  it('parses the stored chart onto the divination model only', () => {
    const card = buildCardData(cardRound, [
      row({ divination_chart: JSON.parse(JSON.stringify(KIGAKU_GANGNAM)) }),
      row({ model_id: 'gpt-5.6-sol', brand: 'OpenAI', camp: 'us', league_tier: 'premier', divination_chart: KIGAKU_GANGNAM }),
    ])
    expect(card.models.find((m) => m.model_id === 'divination')?.divinationChart).toEqual(KIGAKU_GANGNAM)
    expect(card.models.find((m) => m.model_id === 'gpt-5.6-sol')).not.toHaveProperty('divinationChart')
    const malformed = buildCardData(cardRound, [row({ divination_chart: { kind: 'saju', pillars: { year: 'x' } } })])
    expect(malformed.models[0]).not.toHaveProperty('divinationChart')
    expect(parseDivinationChart({ kind: 'other' })).toBeNull()
  })

  const model: CardModelPrediction = {
    prediction_id: 'p-div',
    model_id: 'divination',
    brand: '🔮 점술',
    model_identifier: 'divination',
    camp: 'other',
    league_tier: 'extra',
    direction: 'yes',
    probability: 38,
    magnitude: null,
    qualifierText: 'A',
    reasoning_snippet: '본괘는 길한 흐름입니다.',
    is_correct: null,
    cost_usd: 0.003,
    predicted_at: '2026-09-28T10:00:00.000Z',
    divinationChart: KIGAKU_GANGNAM,
  }

  it('shows one small line on the divination tile and keeps the seat description', () => {
    const html = renderToStaticMarkup(createElement(ModelTile, { model, t: getLeagueUiPack('ko'), locale: 'ko', category: 'real_estate' }))
    expect(html).toContain('data-testid="divination-chart-line"')
    expect(html).toContain('구성기학: 2026년 중궁 일백수성 · 동남방')
    expect(html).toContain('data-testid="extra-role"')
    for (const locale of LEAGUE_LOCALES) {
      const localized = renderToStaticMarkup(createElement(ModelTile, { model, t: getLeagueUiPack(locale), locale }))
      expect(localized, locale).toContain('divination-chart-line')
    }
  })

  it('shows nothing without a chart or on another seat', () => {
    const without = renderToStaticMarkup(
      createElement(ModelTile, { model: { ...model, divinationChart: null }, t: getLeagueUiPack('ko'), locale: 'ko' }),
    )
    expect(without).not.toContain('divination-chart-line')
    const other = renderToStaticMarkup(
      createElement(ModelTile, {
        model: { ...model, model_id: 'sentiment', model_identifier: 'sentiment' },
        t: getLeagueUiPack('ko'),
        locale: 'ko',
      }),
    )
    expect(other).not.toContain('divination-chart-line')
  })
})

describe('NVIDIA tech round opened 2026-10-06', () => {
  beforeEach(() => clearSubjectBirthMemory())

  const nvidiaRound: RoundRow = {
    id: '1b6a3752-2030-4bb2-9bd3-8f2bb344e713',
    proposition_text: 'NVIDIA, 2026-10-06 이후 2026-10-31까지 새 GPU를 발표할까?',
    category: 'tech',
    color_bucket: 'yellow',
    instrument: 'TECH:OPEN:nvidia:announce:새_gpu:20261031:official_newsroom',
    horizon: '1m',
    resolution_rule: 'Occurred if NVIDIA announces 새 GPU after 2026-10-06 and on or before 2026-10-31.',
    resolves_at: '2026-10-31T23:59:59.999+00:00',
    opened_at: '2026-10-06T13:39:23.176764+00:00',
    actual_outcome: null,
    resolved_at: null,
  }
  /** Same hit list Wikidata returns for "NVIDIA": one exact label, the rest products. */
  const nvidiaHits: Hit[] = [
    { id: 'Q182477', label: 'Nvidia', match: { type: 'label', text: 'Nvidia' } },
    { id: 'Q56274119', label: 'Nvidia RTX', match: { type: 'label', text: 'Nvidia RTX' } },
    { id: 'Q114062792', label: 'GeForce RTX 4080', match: { type: 'alias', text: 'Nvidia GeForce RTX 4080' }, aliases: ['Nvidia GeForce RTX 4080'] },
    { id: 'Q825762', label: 'GeForce', match: { type: 'alias', text: 'Nvidia GeForce' }, aliases: ['Nvidia GeForce'] },
  ]

  it('resolves NVIDIA → Jensen Huang through a rate-limited Wikidata and shows "사주: 젠슨 황 계묘년 갑인월"', async () => {
    const wiki = fakeWikidata({ NVIDIA: nvidiaHits }, { Q182477: NVIDIA, Q305177: JENSEN })
    let limited = 1
    const fetchJson = vi.fn(async (url: string) => {
      if (limited-- > 0) throw new WikidataHttpError(429, 800)
      return wiki.fetchJson(url)
    })
    const chart = await buildDivinationChart(
      { ...nvidiaRound, subject_label: 'NVIDIA', created_at: nvidiaRound.opened_at },
      { resolveSubject: (name, category) => resolveSubjectBirth(name, category, { fetchJson, sleep: async () => undefined }) },
    )
    expect(chart?.kind).toBe('saju')
    if (chart?.kind !== 'saju') return
    expect(chart.subject).toMatchObject({ qid: 'Q182477', source: 'ceo_birth', yearMonth: '1963-02', ceo: { qid: 'Q305177' } })
    expect(chart.pillars).toEqual({ year: '癸卯', month: '甲寅' })
    expect(divinationChartPromptLines(chart)[0]).toBe('대상 사주: 젠슨 황(현 CEO) 계묘년 갑인월 (출생 1963-02)')

    const card = buildCardData(nvidiaRound, [
      {
        model_id: 'divination',
        brand: '🔮 점술',
        camp: 'other',
        league_tier: 'extra',
        predicted_direction: 'no',
        predicted_value: 0,
        reasoning_snippet: '본괘인 몽은 미숙함과 배움을 상징합니다.',
        is_correct: null,
        cost_usd: 0.003,
        predicted_at: '2026-10-06T13:40:59.700Z',
        divination_chart: JSON.parse(JSON.stringify(chart)),
      },
    ])
    const tile = card.models.find((m) => m.model_id === 'divination')!
    expect(tile.divinationChart).toEqual(chart)
    const html = renderToStaticMarkup(createElement(ModelTile, { model: tile, t: getLeagueUiPack('ko'), locale: 'ko', category: 'tech' }))
    expect(html).toContain('data-testid="divination-chart-line"')
    expect(html).toContain('사주: 젠슨 황 계묘년 갑인월')
    expect(html).toContain('오락용 점괘')
  })
})

describe('oracle module boundary', () => {
  const ROOT = join(__dirname, '../../..')
  const LEAGUE_DIVINATION_FILES = [
    'divination-calendar.ts',
    'divination-chart.ts',
    'divination-chart-copy.ts',
    'divination-chart-types.ts',
    'divination-direction.ts',
    'divination-ganzhi.ts',
    'divination-live.server.ts',
    'divination-wikidata.ts',
  ]

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : []
    })
  }

  it('oracle files never import the league divination layer', () => {
    for (const file of walk(join(ROOT, 'lib/oracle'))) {
      const src = readFileSync(file, 'utf8')
      for (const mod of LEAGUE_DIVINATION_FILES) {
        expect(src, file).not.toContain(mod.replace(/\.ts$/, ''))
      }
    }
  })

  it('the league layer reaches the oracle only through its league-divination surface', () => {
    const allowed = new Set(['adapter', 'adapter-types', 'cache', 'conventions', 'reader'])
    for (const name of LEAGUE_DIVINATION_FILES) {
      const src = readFileSync(join(ROOT, 'lib/league/extra', name), 'utf8')
      const imports = [...src.matchAll(/from '@\/lib\/oracle\/([^']+)'/g)].map((m) => m[1])
      for (const path of imports) {
        const [scope, leaf] = path.split('/')
        expect(scope, `${name} → ${path}`).toBe('league-divination')
        expect(allowed.has(leaf), `${name} → ${path}`).toBe(true)
      }
      expect(src, name).not.toContain('lib/oracle/engines')
    }
  })
})
