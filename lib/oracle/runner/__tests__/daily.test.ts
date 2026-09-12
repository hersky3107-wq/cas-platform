/**
 * 오늘의 운세: 일진, native weave (no axes), one AI, cache, first-read 2 credits.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fourPillars, tenGodFor } from '../../engines/calendar'
import { personalDataFrom, runComputations } from '../compute'
import { createOracleSession } from '../create'
import { advanceOracleSession } from '../advance'
import { createStubAiAdapter } from '../ai-stub'
import { dailyCacheKey, dailySeed, ORACLE_DAILY_READER_BRAND, ORACLE_DAILY_SYSTEMS } from '../daily'
import { dailyFactsFromNativeCharts, dailyNativeChartsFromResults } from '../daily-facts'
import { isFreeOfPersonalData } from '../privacy'
import { resetAiSlots } from '../concurrency'
import { createFakeCredits, createFakeStore, createScheduler, makeProfile } from './fakes'
import { civilDateIn, creditsForOracleSession, ORACLE_CREDITS_MODULE, ORACLE_DEFAULT_TIMEZONE } from '../conventions'

const NOW = new Date('2026-08-20T03:00:00.000Z')
const USER = 'user-1'
const AS_OF = '2026-08-20'
const NEXT_DAY = '2026-08-21'

function computeDaily(asOfDate: string) {
  const profile = makeProfile()
  return runComputations({
    profile,
    systems: [...ORACLE_DAILY_SYSTEMS],
    seed: dailySeed(USER, asOfDate),
    asOfDate,
    locale: 'ko',
    kind: 'daily',
    question: null,
    sessionInputs: null,
    personalData: personalDataFrom([profile]),
  })
}

describe('saju 일진', () => {
  it('labels today\'s day pillar against the natal 일간, and it moves day to day', () => {
    const today = computeDaily(AS_OF)
    const tomorrow = computeDaily(NEXT_DAY)
    const sajuToday = today.systems.find((row) => row.system === 'saju')!
    const sajuTomorrow = tomorrow.systems.find((row) => row.system === 'saju')!
    const iljinToday = (sajuToday.result as { iljin: { pillar: { ganzhi: string }; tenGods: { stem: string; branch: string } } })
      .iljin
    const iljinTomorrow = (sajuTomorrow.result as { iljin: { pillar: { ganzhi: string } } }).iljin

    const natal = fourPillars({ date: '1988-11-23', time: '04:17', timezone: 'Asia/Seoul' })
    const dayToday = fourPillars({ date: AS_OF, time: '12:00', timezone: 'Asia/Seoul' }).day
    expect(iljinToday.pillar.ganzhi).toBe(dayToday.ganzhi)
    expect(iljinToday.tenGods.stem).toBe(tenGodFor(natal.day.stem, dayToday.stem))
    expect(iljinToday.tenGods.branch).toBe(tenGodFor(natal.day.stem, dayToday.branch))
    expect(iljinTomorrow.pillar.ganzhi).not.toBe(iljinToday.pillar.ganzhi)

    const chart = sajuToday.aiPayload!.systems as { saju: { 일진: { 간지: string; 십신: { 천간: string } } } }
    expect(chart.saju.일진.간지).toBe(dayToday.ganzhi)
    expect(chart.saju.일진.십신.천간).toBe(iljinToday.tenGods.stem)
  })
})

describe('daily native weave', () => {
  it('puts native charts on the saju host payload and never axis scores', () => {
    const computed = computeDaily(AS_OF)
    const host = computed.systems.find((row) => row.system === 'saju')!
    const payload = host.aiPayload!
    expect(payload.kind).toBe('daily')
    expect(payload.readingInput).toBe('native')
    expect(payload.traits).toBeUndefined()
    expect(payload.elements).toBeUndefined()
    expect(payload.phase).toBeUndefined()
    const systems = payload.systems as Record<string, Record<string, unknown>>
    expect(Object.keys(systems).sort()).toEqual([...ORACLE_DAILY_SYSTEMS].sort())
    expect(systems.tarot.카드).toHaveLength(1)
    expect(systems.runes.룬).toHaveLength(1)
    expect(systems.astro.오늘).toBeDefined()
    expect(systems.ninestar.오늘).toBeDefined()
    expect(systems.ninestar.흉방).toBeDefined()
    expect(systems.ninestar.연반).toBeDefined()
    expect(systems.sukuyou.오늘숙).toBeDefined()
    expect(systems.tzolkin.오늘).toBeDefined()

    const pii = personalDataFrom([makeProfile()])
    expect(isFreeOfPersonalData(payload, pii)).toBe(true)
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('"drive"')
    expect(serialized).not.toContain('pickedPosition')
  })

  it('builds the facts strip from the same native charts as the weave payload', () => {
    const computed = computeDaily(AS_OF)
    const host = computed.systems.find((row) => row.system === 'saju')!
    const payloadCharts = host.aiPayload!.systems as Record<string, Record<string, unknown>>
    const fromResults = dailyNativeChartsFromResults(
      computed.systems.map((row) => ({ system: row.system, result: row.result })),
    )
    const fromPayload = dailyFactsFromNativeCharts(payloadCharts)
    const fromSameBuilder = dailyFactsFromNativeCharts(fromResults)
    expect(fromPayload).toEqual(fromSameBuilder)

    const iljin = payloadCharts.saju.일진 as { 간지: string; 십신: { 천간: string; 지지: string } }
    const todayStar = (payloadCharts.ninestar.오늘 as { 일: { 이름: string; 숫자: number } }).일
    const natalStar = payloadCharts.ninestar.일명성 as { 이름: string; 숫자: number }
    const mansion = payloadCharts.sukuyou.오늘숙 as { 한글: string; 한자: string }
    const tz = payloadCharts.tzolkin.오늘 as { 톤: number; 나왈: string }

    expect(fromPayload).toEqual([
      { label: '일진', value: `${iljin.간지} ${iljin.십신.천간}·${iljin.십신.지지}` },
      { label: '오늘의 宿', value: `${mansion.한글} ${mansion.한자}` },
      { label: '일명성', value: `${todayStar.이름} ${todayStar.숫자}` },
      { label: '톤·나왈', value: `톤 ${tz.톤} · ${tz.나왈}` },
    ])
    // Natal 일명성 is a different field. The old strip/model split used both.
    expect(`${todayStar.이름} ${todayStar.숫자}`).not.toBe(`${natalStar.이름} ${natalStar.숫자}`)
  })

  it('keeps the same tarot/rune draw for the same seed (user + civil day)', () => {
    const a = computeDaily(AS_OF)
    const b = computeDaily(AS_OF)
    const tarotA = a.systems.find((row) => row.system === 'tarot')!.result as { draw: { cards: Array<{ id: number }> } }
    const tarotB = b.systems.find((row) => row.system === 'tarot')!.result as { draw: { cards: Array<{ id: number }> } }
    expect(tarotA.draw.cards).toEqual(tarotB.draw.cards)
    const next = computeDaily(NEXT_DAY)
    const tarotN = next.systems.find((row) => row.system === 'tarot')!.result as { draw: { cards: Array<{ id: number }> } }
    expect(tarotN.draw.cards[0]!.id).not.toBe(tarotA.draw.cards[0]!.id)
  })
})

describe('daily runner session', () => {
  beforeEach(() => {
    resetAiSlots()
    vi.stubEnv('ORACLE_AI_MODE', 'live')
  })

  it('charges 2 on the first civil-day read, 0 on a cache re-read, and 2 again on a new local day', async () => {
    const profile = makeProfile()
    const store = createFakeStore({ profiles: [profile] })
    const credits = createFakeCredits()
    const tz = profile.tz ?? ORACLE_DEFAULT_TIMEZONE
    const cacheKey = dailyCacheKey(USER, civilDateIn(NOW, tz))
    expect(cacheKey).toEqual({ user_id: USER, date: AS_OF })

    const created = await createOracleSession(
      USER,
      {
        kind: 'daily',
        subjectProfileId: profile.id,
        scope: 'combined',
        systems: [],
        question: null,
        sessionInputs: null,
        readerCount: 1,
        locale: 'ko',
      },
      { store, credits, now: () => NOW },
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(credits.charges).toEqual([{ userId: USER, amount: 2, module: ORACLE_CREDITS_MODULE }])
    expect(creditsForOracleSession('combined', 1, 'daily')).toBe(2)

    const ai = createStubAiAdapter({ minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} })
    for (let i = 0; i < 8; i += 1) {
      const scheduler = createScheduler()
      await advanceOracleSession(created.session.id, {
        store,
        credits,
        ai,
        schedule: scheduler.schedule,
        now: () => NOW,
        unitTimeoutMs: 50,
      })
      await scheduler.drain()
      const current = await store.getSession(created.session.id)
      if (current && ['done', 'partial', 'failed'].includes(current.status)) break
    }

    const session = (await store.getSession(created.session.id))!
    expect(session.status).toBe('done')
    expect(store.readings).toHaveLength(1)
    expect(store.readings[0]!.brand).toBe(ORACLE_DAILY_READER_BRAND)
    expect(store.verdicts).toHaveLength(0)
    const synthesis = store.consensus[0]?.domain_stats?.synthesis
    expect(synthesis).toBeUndefined()
    expect(store.dailyCaches).toHaveLength(1)
    expect(store.dailyCaches[0]).toMatchObject(cacheKey)
    expect(store.dailyCaches[0]!.session_id).toBe(session.id)

    const reopen = await createOracleSession(
      USER,
      {
        kind: 'daily',
        subjectProfileId: profile.id,
        scope: 'combined',
        systems: [],
        question: null,
        sessionInputs: null,
        readerCount: 1,
        locale: 'ko',
      },
      { store, credits, now: () => NOW },
    )
    expect(reopen.ok).toBe(true)
    if (!reopen.ok) return
    expect(reopen.reused).toBe(true)
    expect(reopen.session.id).toBe(session.id)
    expect(credits.charges).toEqual([{ userId: USER, amount: 2, module: ORACLE_CREDITS_MODULE }])

    const nextMorning = new Date('2026-08-21T03:00:00.000Z')
    const nextKey = dailyCacheKey(USER, civilDateIn(nextMorning, tz))
    expect(nextKey).toEqual({ user_id: USER, date: NEXT_DAY })
    expect(nextKey.date).not.toBe(cacheKey.date)

    const nextDay = await createOracleSession(
      USER,
      {
        kind: 'daily',
        subjectProfileId: profile.id,
        scope: 'combined',
        systems: [],
        question: null,
        sessionInputs: null,
        readerCount: 1,
        locale: 'ko',
      },
      { store, credits, now: () => nextMorning },
    )
    expect(nextDay.ok).toBe(true)
    if (!nextDay.ok) return
    expect(nextDay.reused).toBe(false)
    expect(nextDay.session.id).not.toBe(session.id)
    expect(credits.charges).toEqual([
      { userId: USER, amount: 2, module: ORACLE_CREDITS_MODULE },
      { userId: USER, amount: 2, module: ORACLE_CREDITS_MODULE },
    ])
    expect(nextDay.session.credits_charged).toBe(2)
    expect(nextDay.session.seed).toBe(`daily:${USER}:${NEXT_DAY}`)
  })
})
