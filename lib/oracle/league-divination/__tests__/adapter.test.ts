import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLeagueDivination } from '../adapter'
import {
  LEAGUE_ADAPTER_CUSTOMER_KEYS,
  LEAGUE_DIVINATION_ADAPTER_INPUT_KEYS,
  type LeagueDivinationAdapterInput,
} from '../adapter-types'
import { createMemoryLeagueDivinationCache } from '../cache'
import { fallbackRationale } from '../fallback'
import { compactReaderPack } from '../compact-pack'
import { computeLeagueDivination } from '../compute'
import { findMarketLanguage } from '../parse-reader'
import type { LeagueReaderCall } from '../reader'

const BASE: LeagueDivinationAdapterInput = {
  proposition: 'Will the listed name close higher than the open print?',
  propositionType: 'binary',
  category: 'stocks',
  subjectName: '005930',
  firstViewedAt: '2026-09-19T08:52:00.000Z',
  roundId: 'round-adapter-1',
}

const FOUR_OK = [
  '육효 용신 妻财는 월령 왕이다.',
  '타로 결과 패는 The Sun 정방향이다.',
  '룬 미래는 Fehu 정방향이다.',
  '택일 일진이 용신을 생한다.',
].join('\n')

function readerThat(text: string): LeagueReaderCall {
  return async () => ({ text })
}

type MarketKey = 'price' | 'volume' | 'news' | 'fundamentals' | 'packet' | 'research'
type InputOverlap = keyof LeagueDivinationAdapterInput & MarketKey
const _noMarketFields: InputOverlap extends never ? true : false = true
void _noMarketFields

describe('adapter input contract forbids market data', () => {
  it('lists only the six agreed keys', () => {
    expect([...LEAGUE_DIVINATION_ADAPTER_INPUT_KEYS].sort()).toEqual(
      ['category', 'firstViewedAt', 'proposition', 'propositionType', 'roundId', 'subjectName'].sort(),
    )
    const source = readFileSync(resolve(__dirname, '../adapter-types.ts'), 'utf8')
    for (const needle of ['price', 'volume', 'news', 'fundamentals', 'packet', 'research', '시세', '거래량']) {
      expect(source).not.toMatch(new RegExp(`\\b${needle}\\b`))
    }
  })
})

describe('readLeagueDivination', () => {
  it('never lets the reader override the code verdict', async () => {
    const opposite = [
      '육효 용신이 약하다.',
      '타로 결과 패는 Death 정방향이다.',
      '룬 미래는 Hagalaz 정방향이다.',
      '그래서 하락이 맞다.',
    ].join('\n')
    const computed = computeLeagueDivination({
      roundId: BASE.roundId,
      firstViewIso: BASE.firstViewedAt,
      categoryId: BASE.category,
      axis: 'direction',
    })
    const output = await readLeagueDivination(BASE, {
      cache: createMemoryLeagueDivinationCache(),
      reader: readerThat(opposite),
    })
    const expected = computed.aggregate.vote === 'a' || computed.aggregate.vote === 'up' ? 'up' : 'down'
    expect(output.verdict).toBe(expected)
    expect(output.verdict === 'up' || output.verdict === 'down').toBe(true)
    const pack = compactReaderPack(computed, { proposition: BASE.proposition, subjectName: BASE.subjectName })
    expect(output.rationale).toBe(fallbackRationale(pack))
    expect(findMarketLanguage(output.rationale)).toBeNull()
  })

  it('uses the code ballot even when the reader agrees in prose', async () => {
    const computed = computeLeagueDivination({
      roundId: BASE.roundId,
      firstViewIso: BASE.firstViewedAt,
      categoryId: BASE.category,
      axis: 'direction',
    })
    const output = await readLeagueDivination(
      { ...BASE, roundId: 'round-adapter-agree' },
      { cache: createMemoryLeagueDivinationCache(), reader: readerThat(FOUR_OK) },
    )
    const expected = computed.aggregate.vote === 'a' || computed.aggregate.vote === 'up' ? 'up' : 'down'
    expect(output.verdict).toBe(expected)
    expect(output.pick).toBeNull()
    expect(output.rationale).toBe(FOUR_OK)
    expect(output.systems).toHaveLength(6)
    expect(output.systems.find((row) => row.id === 'iching')?.status).toBe('voted')
    expect(output.systems.find((row) => row.id === 'astro')?.status).toBe('결번')
    expect(output.systems.find((row) => row.id === 'astro')?.statusLabel).toBe('말을 아낌')
    expect(output.systems.find((row) => row.id === 'ninestar')?.status).toBe('결번')
    expect(output.systems.find((row) => row.id === 'taeil')?.chart.label).toBe('택일')
    expect(output.votedCount).toBeGreaterThanOrEqual(1)
    expect(output.votedCount).toBeLessThanOrEqual(4)
    expect([...LEAGUE_ADAPTER_CUSTOMER_KEYS]).toEqual(['verdict', 'pick', 'rationale', 'confidence'])
    expect(output.rationale).not.toMatch(/결번|말을 아낌|말을 아꼈|표를 냄|홀로 표를/)
  })

  it('caches on roundId so a later viewer sees the identical packed result', async () => {
    const cache = createMemoryLeagueDivinationCache()
    let calls = 0
    const reader: LeagueReaderCall = async () => {
      calls += 1
      return { text: FOUR_OK }
    }
    const first = await readLeagueDivination(BASE, { cache, reader })
    const second = await readLeagueDivination(
      { ...BASE, firstViewedAt: '2026-09-20T00:00:00.000Z', proposition: 'different wording' },
      { cache, reader },
    )
    expect(calls).toBe(1)
    expect(second).toEqual(first)
  })

  it('pick_one fills pick A/B and still never nulls verdict', async () => {
    const output = await readLeagueDivination(
      { ...BASE, roundId: 'round-pick', propositionType: 'pick_one', category: 'sports', subjectName: 'A vs B' },
      { cache: createMemoryLeagueDivinationCache(), reader: readerThat(FOUR_OK) },
    )
    expect(output.verdict === 'up' || output.verdict === 'down').toBe(true)
    expect(output.pick === 'A' || output.pick === 'B').toBe(true)
  })
})
