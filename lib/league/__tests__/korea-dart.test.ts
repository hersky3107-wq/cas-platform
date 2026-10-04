import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scrubAnalystDisclosure } from '../analyst-disclosure'
import { krGroupLabel } from '../korea-equity-catalog'
import { KR_STOCK_QUERY_SET_VERSION, krStockAugmentationQueries } from '../korea-stock-display'
import {
  dartStatusKind,
  deriveFundamentals,
  formatKrDartPacket,
  fundamentalsActionAfterProbe,
  isDartCacheFresh,
  mapStockCodesToCorps,
  normalizeDisclosureType,
  packetAfterDisclosureFetch,
  parseCorpCodeXml,
  planDartFetches,
  selectFinancialReports,
  type DartAccountRow,
  type DisclosurePayload,
} from '../korea-dart-model'
import { buildResearchCacheKey } from '../research'
import { stockAugmentationQueries } from '../gateway/adapters/stock-catalog'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { parseDartCorpSyncArgs, runDartCorpSync } from '../../../scripts/league/dart-corp-sync'

const NOW = new Date('2026-10-04T03:00:00.000Z')

describe('OpenDART corp mapping', () => {
  it('maps a 6-digit stock code and keeps the later modify_date', () => {
    const xml = `
      <result>
        <list>
          <corp_code>00126380</corp_code>
          <corp_name>삼성전자</corp_name>
          <stock_code>005930</stock_code>
          <modify_date>20170630</modify_date>
        </list>
        <list>
          <corp_code>00999999</corp_code>
          <corp_name>옛삼성</corp_name>
          <stock_code>005930</stock_code>
          <modify_date>20100101</modify_date>
        </list>
        <list>
          <corp_code>01234567</corp_code>
          <corp_name>에코프로비엠</corp_name>
          <stock_code>247540</stock_code>
          <modify_date>20240101</modify_date>
        </list>
        <list>
          <corp_code>00000001</corp_code>
          <corp_name>비상장</corp_name>
          <stock_code></stock_code>
          <modify_date>20200101</modify_date>
        </list>
      </result>`
    const corps = parseCorpCodeXml(xml)
    const mapped = mapStockCodesToCorps(['005930', '247540', '000660'], corps)
    expect(mapped).toEqual([
      { stockCode: '005930', corpCode: '00126380', corpName: '삼성전자' },
      { stockCode: '247540', corpCode: '01234567', corpName: '에코프로비엠' },
    ])
  })
})

describe('OpenDART disclosure types', () => {
  it('maps 유상증자, 정정, and 투자경고', () => {
    expect(normalizeDisclosureType('주요사항보고서(유상증자결정)')).toBe('rights_issue')
    expect(normalizeDisclosureType('[정정]사업보고서')).toBe('amended_filing')
    expect(normalizeDisclosureType('투자경고종목지정')).toBe('investor_warning')
  })
})

describe('KRSTOCK OpenDART packet lines', () => {
  const disclosures: DisclosurePayload = {
    ok: true,
    items: [
      { date: '2026-09-28', type: 'rights_issue', title: '유상증자 결정' },
      { date: '2026-09-20', type: 'large_contract', title: '단일판매ㆍ공급계약체결' },
    ],
  }
  const fundamentals = {
    ok: true as const,
    newestRceptNo: '20260814000123',
    revenueYoy: 0.124,
    operatingMargin: 0.081,
    debtRatio: 0.642,
    basis: 'consolidated' as const,
    annualFilingDate: '2026-03-18',
    quarterFilingDates: ['2026-08-14', '2026-05-15'],
  }

  it('1d dampens fundamentals and 1w says they matter modestly', () => {
    const day = formatKrDartPacket({ horizon: '1d', disclosures, fundamentals })
    expect(day).toContain('Recent disclosures (OpenDART, last 30 days):')
    expect(day).toContain('- 2026-09-28 rights issue — 유상증자 결정')
    expect(day).toContain('argues higher close: 2026-09-20 large contract')
    expect(day).toContain('argues lower close: 2026-09-28 rights issue')
    expect(day).toContain('revenue YoY: 12.4%')
    expect(day).toContain('operating margin: 8.1%')
    expect(day).toContain('debt ratio: 64.2%')
    expect(day).toContain('Fundamentals rarely move a single session; weigh them lightly for 1d.')
    expect(day).not.toContain('matter modestly')

    const week = formatKrDartPacket({ horizon: '1w', disclosures, fundamentals })
    expect(week).toContain('Fundamentals matter modestly over 1w; disclosures and flows usually dominate.')
    expect(week).not.toContain('weigh them lightly')
  })

  it('1m and 3m have no dampening line', () => {
    for (const horizon of ['1m', '3m']) {
      const text = formatKrDartPacket({ horizon, disclosures, fundamentals })
      expect(text).toContain('Fundamentals (latest filings):')
      expect(text).not.toContain('weigh them lightly')
      expect(text).not.toContain('matter modestly')
    }
  })

  it('an empty list says none on both sides', () => {
    const text = formatKrDartPacket({
      horizon: '1m',
      disclosures: { ok: true, items: [] },
      fundamentals,
    })
    expect(text).toContain('none')
    expect(text).toContain('argues higher close: none')
    expect(text).toContain('argues lower close: none')
  })
})

describe('OpenDART cache freshness and API failure', () => {
  it('disclosures stay fresh for 6 hours and fundamentals for a day', () => {
    const fiveHours = new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString()
    const sevenHours = new Date(NOW.getTime() - 7 * 60 * 60 * 1000).toISOString()
    const twentyHours = new Date(NOW.getTime() - 20 * 60 * 60 * 1000).toISOString()
    const twentyFiveHours = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString()
    expect(isDartCacheFresh('disclosures', fiveHours, NOW)).toBe(true)
    expect(isDartCacheFresh('disclosures', sevenHours, NOW)).toBe(false)
    expect(isDartCacheFresh('fundamentals', twentyHours, NOW)).toBe(true)
    expect(isDartCacheFresh('fundamentals', twentyFiveHours, NOW)).toBe(false)
    expect(
      planDartFetches({
        now: NOW,
        disclosuresFetchedAt: fiveHours,
        fundamentalsFetchedAt: twentyHours,
        fundamentalsHavePayload: true,
      }),
    ).toEqual({ disclosures: 'use_cache', fundamentals: 'use_cache' })
    expect(
      planDartFetches({
        now: NOW,
        disclosuresFetchedAt: sevenHours,
        fundamentalsFetchedAt: twentyFiveHours,
        fundamentalsHavePayload: true,
      }),
    ).toEqual({ disclosures: 'fetch', fundamentals: 'probe' })
    expect(
      planDartFetches({
        now: NOW,
        disclosuresFetchedAt: null,
        fundamentalsFetchedAt: null,
        fundamentalsHavePayload: false,
      }),
    ).toEqual({ disclosures: 'fetch', fundamentals: 'fetch' })
  })

  it('a failed call with no cache writes the unavailable lines and does not invent ratios', () => {
    expect(dartStatusKind(null)).toBe('fail')
    expect(dartStatusKind({ status: '020' })).toBe('fail')
    expect(dartStatusKind({ status: '013' })).toBe('empty')
    expect(dartStatusKind({ status: '000', list: [] })).toBe('ok')
    expect(packetAfterDisclosureFetch({ cacheFresh: false, cached: null, fetchBody: null })).toBe('unavailable')
    expect(fundamentalsActionAfterProbe({ cachedNewestRceptNo: null, probe: 'fail' })).toBe('unavailable')
    const cached: DisclosurePayload = { ok: true, items: [] }
    expect(packetAfterDisclosureFetch({ cacheFresh: true, cached, fetchBody: null })).toEqual(cached)
    expect(fundamentalsActionAfterProbe({ cachedNewestRceptNo: '20260101000111', probe: 'fail' })).toBe('keep')
    expect(
      fundamentalsActionAfterProbe({
        cachedNewestRceptNo: '20260101000111',
        probe: { newestRceptNo: '20260101000111' },
      }),
    ).toBe('keep')
    expect(
      fundamentalsActionAfterProbe({
        cachedNewestRceptNo: '20260101000111',
        probe: { newestRceptNo: '20260201000111' },
      }),
    ).toBe('refetch')
    const text = formatKrDartPacket({ horizon: '1d', disclosures: 'unavailable', fundamentals: 'unavailable' })
    expect(text).toContain('disclosures unavailable')
    expect(text).toContain('fundamentals unavailable')
    expect(text).not.toMatch(/\d+\.\d+%/)
    expect(text).not.toContain('weigh them lightly')
  })

  it('derives ratios from consolidated filings and ignores the separate statement', () => {
    const rows: DartAccountRow[] = [
      {
        reprtCode: '11014',
        bsnsYear: '2026',
        rceptNo: '20260814000111',
        fsDiv: 'CFS',
        accountNm: '매출액',
        thstrmAmount: '112.4',
        frmtrmAmount: '100',
      },
      {
        reprtCode: '11014',
        bsnsYear: '2026',
        rceptNo: '20260814000111',
        fsDiv: 'CFS',
        accountNm: '영업이익',
        thstrmAmount: '9.1044',
        frmtrmAmount: '7',
      },
      {
        reprtCode: '11014',
        bsnsYear: '2026',
        rceptNo: '20260814000111',
        fsDiv: 'CFS',
        accountNm: '부채총계',
        thstrmAmount: '642',
        frmtrmAmount: '600',
      },
      {
        reprtCode: '11014',
        bsnsYear: '2026',
        rceptNo: '20260814000111',
        fsDiv: 'CFS',
        accountNm: '자본총계',
        thstrmAmount: '1000',
        frmtrmAmount: '900',
      },
      {
        reprtCode: '11014',
        bsnsYear: '2026',
        rceptNo: '20260814000111',
        fsDiv: 'OFS',
        accountNm: '매출액',
        thstrmAmount: '1',
        frmtrmAmount: '1',
      },
      {
        reprtCode: '11011',
        bsnsYear: '2025',
        rceptNo: '20260318000999',
        fsDiv: 'CFS',
        accountNm: '자산총계',
        thstrmAmount: '10',
        frmtrmAmount: '9',
      },
    ]
    const derived = deriveFundamentals(rows)
    expect(derived.revenueYoy).toBeCloseTo(0.124)
    expect(derived.operatingMargin).toBeCloseTo(0.081)
    expect(derived.debtRatio).toBeCloseTo(0.642)
    expect(derived.basis).toBe('consolidated')
    expect(derived.annualFilingDate).toBe('2026-03-18')
    expect(derived.quarterFilingDates).toEqual(['2026-08-14'])
  })

  it('selects the latest annual plus the latest quarter filings', () => {
    const picked = selectFinancialReports([
      { reportNm: '분기보고서 (2026.03)', rceptNo: '20260515000001' },
      { reportNm: '반기보고서 (2026.06)', rceptNo: '20260814000001' },
      { reportNm: '[기재정정]반기보고서 (2026.06)', rceptNo: '20260820000001' },
      { reportNm: '사업보고서 (2025.12)', rceptNo: '20260318000001' },
      { reportNm: '분기보고서 (2025.09)', rceptNo: '20251114000001' },
    ])
    expect(picked.map((row) => `${row.bsnsYear}:${row.reprtCode}:${row.rceptNo}`)).toEqual([
      '2026:11012:20260820000001',
      '2026:11013:20260515000001',
      '2025:11011:20260318000001',
      '2025:11014:20251114000001',
    ])
  })
})

describe('OpenDART corp sync dry-run', () => {
  it('makes no network calls unless --apply', async () => {
    expect(parseDartCorpSyncArgs([]).apply).toBe(false)
    const list = vi.fn(async () => {
      throw new Error('list must not run in dry-run')
    })
    const download = vi.fn(async () => {
      throw new Error('download must not run in dry-run')
    })
    const upsert = vi.fn(async () => {
      throw new Error('upsert must not run in dry-run')
    })
    const lines: string[] = []
    await runDartCorpSync([], { log: (message) => lines.push(message), listKrStockCodes: list, downloadCorpCodeZip: download, upsertCorps: upsert })
    expect(lines[0]).toContain('dry-run')
    expect(lines[0]).toContain('No request sent')
    expect(list).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('KRSTOCK research queries', () => {
  it('replaces the generic seeds with three company and sector queries', () => {
    const qs = krStockAugmentationQueries('에코프로비엠', '247540', '2차전지')
    expect(qs).toHaveLength(3)
    expect(qs.map((q) => q.q)).toEqual([
      '최근 7일 에코프로비엠 핵심 악재·호재',
      '에코프로비엠 공시·유상증자·전환사채·수주·소송·규제',
      '2차전지 업황 최근 동향',
    ])
    expect(qs.every((q) => q.lang === 'ko')).toBe(true)
    expect(krGroupLabel('battery')).toBe('2차전지')
    const joined = qs.map((q) => q.q).join('\n')
    expect(joined).not.toContain('최근 뉴스와 주가 촉매')
    const us = stockAugmentationQueries({ instrument: 'STOCK:NYSE:TSM', category: 'stock' })
    expect(us).toHaveLength(6)

    const plain = buildResearchCacheKey({
      instrument: 'KRSTOCK:KOSDAQ:247540',
      horizon: '1d',
      now: NOW,
      extraQueries: qs,
    })
    const bumped = buildResearchCacheKey({
      instrument: 'KRSTOCK:KOSDAQ:247540',
      horizon: '1d',
      now: NOW,
      extraQueries: qs,
      querySetVersion: KR_STOCK_QUERY_SET_VERSION,
    })
    expect(plain.startsWith('rp_v4|KRSTOCK:KOSDAQ:247540|1d|')).toBe(true)
    expect(plain).toContain('|eq3')
    expect(plain).not.toContain('|qs2')
    expect(bumped).toBe(`${plain}|qs2`)
  })

  it('keeps filing facts and still scrubs flow amounts', () => {
    const kept = scrubAnalystDisclosure('유상증자 1.2조와 매출 YoY 12.4%는 공시 사실이다')
    expect(kept).toContain('유상증자')
    expect(kept).toContain('1.2조')
    expect(kept).toContain('12.4%')
    const dropped = scrubAnalystDisclosure('333억 규모의 기관 순매수')
    expect(dropped).not.toContain('333')
    expect(dropped).toContain('기관 순매수')
  })
})

describe('KRSTOCK packet wiring', () => {
  it('loads OpenDART for every KRSTOCK horizon and does not print the key', () => {
    const stocks = readFileSync(join(__dirname, '../gateway/adapters/stocks.ts'), 'utf8')
    const dart = readFileSync(join(__dirname, '../korea-dart.ts'), 'utf8')
    expect(stocks).toContain('loadKrDartPacketSection')
    expect(stocks).toContain('KR_STOCK_QUERY_SET_VERSION')
    expect(dart).toContain("import 'server-only'")
    expect(dart).toContain('list.json')
    expect(dart).toContain('fnlttSinglAcnt.json')
    expect(dart).toContain('planDartFetches')
    expect(dart).not.toMatch(/console\.(log|error)\([^)]*OPENDART_API_KEY/)
    expect(dart).not.toMatch(/console\.(log|error)\(url\)/)
  })
})
