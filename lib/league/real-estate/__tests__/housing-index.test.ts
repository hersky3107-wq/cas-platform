import { describe, expect, it } from 'vitest'
import { resolvePropertyTarget } from '../../gateway/adapters/real-estate-target'
import { decodePropertyInstrument, propertyResolutionRule, publicationMs } from '../../gateway/adapters/real-estate-catalog'
import { propertyRegion } from '../../gateway/adapters/real-estate-regions'
import { decideHousingGrade } from '../grade'
import { formatHousingIndexBlock } from '../packet-index'
import {
  catalogRegionForEstatArea,
  catalogRegionForRoneName,
  catalogRegionForRonePath,
  lastWeeklyRonePrints,
  mlitHousingWorkbookUrl,
  mlitSheetRegion,
  parseEstatHousing,
  parseFredObservations,
  parseMlitHousingRow,
  parseRoneTable,
  parseUkHpiCsv,
  redactHousingSecrets,
  ukHpiPeriod,
} from '../parse'
import { estatListTables, fredSeriesForRegion, roneTableForRegion, roneTimeWindows, ukHpiCandidateStamps } from '../clients'
import { supportedRegionsLine } from '../supported'
import { refusalMessageForKey } from '../../gateway/refusal-copy'
import { LEAGUE_LOCALES } from '../../i18n/locales'
import { planVintageWrites, priorPeriod } from '../vintage'
import { housingEvidenceFromInstrument } from '../evidence'

const NOW = new Date('2026-10-05T00:00:00.000Z')

describe('housing index parsers', () => {
  it('reads FRED observations and skips missing values', () => {
    const points = parseFredObservations(
      {
        observations: [
          { date: '2026-05-01', value: '318.4' },
          { date: '2026-06-01', value: '.' },
          { date: '2026-07-01', value: '320.1' },
        ],
      },
      'CSUSHPINSA',
    )
    expect(points.map((row) => row.refPeriod)).toEqual(['2026-05', '2026-07'])
    expect(points[1]?.value).toBe(320.1)
    expect(fredSeriesForRegion({ country: 'US', code: 'LXXRNSA', tier: 'official' })).toBe('LXXRNSA')
    expect(fredSeriesForRegion({ country: 'US', code: 'FHFA_CA', tier: 'fhfa' })).toBe('CASTHPI')
    expect(fredSeriesForRegion({ country: 'US', code: 'ZZSOHO', tier: 'zillow' })).toBeNull()
  })

  it('reads the UK HPI index column by area code', () => {
    const csv = [
      'Date,RegionName,AreaCode,AveragePrice,Index',
      '2026-05-01,United Kingdom,K02000001,300,128.2',
      '2026-06-01,London,E12000007,500,140.5',
    ].join('\n')
    const points = parseUkHpiCsv(csv)
    expect(points).toEqual([
      { refPeriod: '2026-05', value: 128.2, areaCode: 'K02000001', seriesId: 'UK-HPI' },
      { refPeriod: '2026-06', value: 140.5, areaCode: 'E12000007', seriesId: 'UK-HPI' },
    ])
    const dmy = parseUkHpiCsv('Date,AreaCode,Index\n01/07/2026,K02000001,130.4')
    expect(dmy[0]?.refPeriod).toBe('2026-07')
    expect(ukHpiPeriod('01/02/2004')).toBe('2004-02')
    expect(ukHpiCandidateStamps(new Date('2026-10-05T00:00:00.000Z'))[0]).toBe('2026-08')
  })

  it('reads an R-ONE monthly table and matches 시군구 names', () => {
    const rows = parseRoneTable({
      SttsApiTblData: [
        { head: [{ list_total_count: 1 }] },
        { row: [{ WRTTIME_IDTFR_ID: '202609', CLS_NM: '강남구', CLS_ID: '999', DTA_VAL: '101.25' }] },
      ],
    })
    expect(rows[0]).toMatchObject({ refPeriod: '2026-09', value: 101.25 })
    expect(catalogRegionForRoneName(rows[0]!.clsName)).toBe('11680')
    expect(catalogRegionForRoneName('전국')).toBe('NAT')
    expect(roneTableForRegion('11').statblId).toBe('A_2024_00178')
    expect(roneTableForRegion('11680').statblId).toBe('A_2024_00045')
    const windows = roneTimeWindows(new Date('2026-10-05T00:00:00.000Z'), 'MM')
    expect(windows.at(-1)).toEqual({ start: '202601', end: '202610' })
    expect(windows[0]).toEqual({ start: '202301', end: '202312' })
    expect(roneTimeWindows(new Date('2026-10-05T00:00:00.000Z'), 'WK').at(-1)).toEqual({ start: '202601', end: '202653' })
    expect(catalogRegionForRonePath('종로구', '서울>강북지역>도심권>종로구')).toBe('11110')
    expect(catalogRegionForRonePath('중구', '대전>중구')).toBeNull()
    expect(catalogRegionForRonePath('중구', '서울>강북지역>도심권>중구')).toBe('11140')
    const weekly = lastWeeklyRonePrints([
      { refPeriod: '2026-05', value: 1, clsId: '1', clsName: '강남구', clsFullName: '서울>강남구', itmName: '지수', observedOn: '2026-05-04' },
      { refPeriod: '2026-05', value: 2, clsId: '1', clsName: '강남구', clsFullName: '서울>강남구', itmName: '지수', observedOn: '2026-05-25' },
      { refPeriod: '2026-06', value: 3, clsId: '1', clsName: '강남구', clsFullName: '서울>강남구', itmName: '지수', observedOn: '2026-06-01' },
    ])
    expect(weekly.map((row) => [row.refPeriod, row.value])).toEqual([
      ['2026-05', 2],
      ['2026-06', 3],
    ])
  })

  it('reads the e-Stat residential composite and ignores commercial rows', () => {
    const points = parseEstatHousing(
      {
        GET_STATS_DATA: {
          STATISTICAL_DATA: {
            CLASS_INF: {
              CLASS_OBJ: [
                { '@id': 'area', CLASS: [{ '@code': '13', '@name': '東京都' }] },
                {
                  '@id': 'cat01',
                  CLASS: [
                    { '@code': '01', '@name': '住宅総合' },
                    { '@code': '09', '@name': '商業用' },
                  ],
                },
              ],
            },
            DATA_INF: {
              VALUE: [
                { '@time': '202607', '@area': '13', '@cat01': '01', $: '130.2' },
                { '@time': '202607', '@area': '13', '@cat01': '09', $: '90' },
              ],
            },
          },
        },
      },
      'table-1',
    )
    expect(points).toHaveLength(1)
    expect(points[0]?.refPeriod).toBe('2026-07')
    expect(catalogRegionForEstatArea('東京都')).toBe('13')
    expect(catalogRegionForEstatArea('南関東')).toBe('SOUTH_KANTO')
    expect(estatListTables({ GET_STATS_LIST: { DATALIST_INF: { TABLE_INF: { '@id': '0001', TITLE: { $: '不動産価格指数（住宅）' } } } } })[0]).toEqual({
      id: '0001',
      title: '不動産価格指数（住宅）',
    })
    expect(mlitSheetRegion('全国Japan原系列')).toBe('NAT')
    expect(mlitSheetRegion('全国Japan季節調整')).toBeNull()
    expect(mlitSheetRegion('南関東圏Tokyo including原系列')).toBe('SOUTH_KANTO')
    expect(parseMlitHousingRow([null, '2008-04-01T00:00:00.000Z', 107.92], '全国Japan原系列', '001473668')).toMatchObject({
      refPeriod: '2008-04',
      value: 107.92,
      areaCode: 'NAT',
      seriesId: '001473668',
    })
    const html = '<h3>最新データ</h3><td>不動産価格指数（住宅）</td><td><a href="/totikensangyo/content/001473668.xlsx">Excel</a></td>'
    expect(mlitHousingWorkbookUrl(html)).toBe('/totikensangyo/content/001473668.xlsx')
  })

  it('redacts keys from error text', () => {
    expect(redactHousingSecrets('fail api_key=abc&KEY=secret&appId=xyz')).toBe(
      'fail api_key=REDACTED&KEY=REDACTED&appId=REDACTED',
    )
  })
})

describe('housing vintage and grading', () => {
  it('keeps the first value and stores a later difference as a revision', () => {
    const first = planVintageWrites(new Map(), [{ refPeriod: '2026-06', value: 100 }], '2026-08-01T00:00:00.000Z')
    expect(first).toEqual([{ kind: 'first', refPeriod: '2026-06', value: 100, seenAt: '2026-08-01T00:00:00.000Z' }])
    const same = planVintageWrites(new Map([['2026-06', 100]]), [{ refPeriod: '2026-06', value: 100 }], '2026-09-01T00:00:00.000Z')
    expect(same).toEqual([])
    const revised = planVintageWrites(new Map([['2026-06', 100]]), [{ refPeriod: '2026-06', value: 101 }], '2026-09-01T00:00:00.000Z')
    expect(revised[0]?.kind).toBe('revision')
    expect(priorPeriod('2026-06', 'month')).toBe('2026-05')
    expect(priorPeriod('2026-06', 'quarter')).toBe('2026-03')
  })

  it('grades up or down from first prints, ties nobody, and queues after the grace', () => {
    const seoul = propertyRegion('KR', '11')!
    const release = publicationMs(seoul, '2026-09')
    const up = decideHousingGrade({
      current: 101,
      prior: 100,
      thresholdBp: null,
      nowMs: release + 1,
      expectedReleaseMs: release,
      evidence: 'source R-ONE',
    })
    expect(up.kind).toBe('up')
    const down = decideHousingGrade({
      current: 99,
      prior: 100,
      thresholdBp: null,
      nowMs: release,
      expectedReleaseMs: release,
      evidence: 'source R-ONE',
    })
    expect(down.kind).toBe('down')
    const tie = decideHousingGrade({
      current: 100,
      prior: 100,
      thresholdBp: null,
      nowMs: release,
      expectedReleaseMs: release,
      evidence: 'source R-ONE',
    })
    expect(tie.kind).toBe('equal')
    const thresholdTie = decideHousingGrade({
      current: 101,
      prior: 100,
      thresholdBp: 100,
      nowMs: release,
      expectedReleaseMs: release,
      evidence: 'source R-ONE',
    })
    expect(thresholdTie.kind).toBe('equal')
    const pending = decideHousingGrade({
      current: null,
      prior: 100,
      thresholdBp: null,
      nowMs: release,
      expectedReleaseMs: release,
      evidence: 'source R-ONE',
    })
    expect(pending.kind).toBe('pending')
    const manual = decideHousingGrade({
      current: null,
      prior: 100,
      thresholdBp: null,
      nowMs: release + 11 * 86_400_000,
      expectedReleaseMs: release,
      evidence: 'source R-ONE',
    })
    expect(manual.kind).toBe('manual')
  })

  it('refuses a new Australian round and an unofficial neighborhood', () => {
    const hit = resolvePropertyTarget('시드니 집값 오를까', NOW)
    expect(hit.kind).toBe('index_discontinued')
    expect(resolvePropertyTarget('소호 집값', NOW).kind).toBe('index_unsupported')
    const ko = supportedRegionsLine('ko')
    expect(ko).toContain('지원 지역: 한국(전국·시도·시군구)')
    expect(ko).toContain('미국(전국·주요 20개 도시·6개 주)')
    expect(ko).toContain('영국(')
    expect(ko).toContain('일본(')
    expect(ko).not.toContain('호주')
    for (const locale of LEAGUE_LOCALES) {
      const line = supportedRegionsLine(locale)
      expect(line.length).toBeGreaterThan(10)
      const message = refusalMessageForKey('league.gateway.refusal.index_unsupported', locale)
      expect(message).toContain(line)
    }
  })

  it('puts the index in the packet and keeps search secondary', () => {
    const region = propertyRegion('US', 'CSUSHPINSA')!
    const block = formatHousingIndexBlock(
      {
        country: 'US',
        regionCode: 'CSUSHPINSA',
        metric: 'hpi_mom',
        refMonth: '2026-07',
        thresholdBp: null,
        region,
        resolvesAtMs: publicationMs(region, '2026-07'),
      },
      {
        source: 'FRED',
        seriesId: 'CSUSHPINSA',
        sourceUrl: 'https://fred.stlouisfed.org/series/CSUSHPINSA',
        levels: [
          { refPeriod: '2025-07', value: 300 },
          { refPeriod: '2026-06', value: 318.4 },
          { refPeriod: '2026-07', value: 320.1 },
        ],
        national: null,
      },
    )
    expect(block).toContain('OFFICIAL INDEX')
    expect(block).toContain('2026-07 320.10')
    expect(block).toContain('MoM')
    expect(block).toContain('YoY')
    expect(block).toContain('BOTH SIDES')
    expect(block).not.toContain('321')
    const evidence = housingEvidenceFromInstrument('PROPERTY:US:CSUSHPINSA:hpi_mom:2026-07', [
      { refPeriod: '2026-06', value: 318.4, firstPublishedAt: '2026-08-26T00:00:00.000Z' },
      { refPeriod: '2026-07', value: 320.1, firstPublishedAt: '2026-09-30T00:00:00.000Z' },
    ])
    expect(evidence).toContain('FRED')
    expect(evidence).toContain('CSUSHPINSA')
    expect(evidence).toContain('320.1')
    expect(evidence).toContain('318.4')
    expect(evidence).toContain('https://fred.stlouisfed.org/series/CSUSHPINSA')
    const gangnam = decodePropertyInstrument('PROPERTY:KR:11680:apt_sale_mom:2026-07')
    expect(gangnam).not.toBeNull()
    const rule = propertyResolutionRule(gangnam!)
    expect(rule).toContain('A_2024_00045')
    expect(rule).toContain('T244183132827305')
    const guEvidence = housingEvidenceFromInstrument('PROPERTY:KR:11110:apt_sale_mom:2026-07')
    expect(guEvidence).toContain('A_2024_00045')
    expect(guEvidence).toContain('T244183132827305')
    expect(guEvidence).toContain('https://www.reb.or.kr/')
  })
})
