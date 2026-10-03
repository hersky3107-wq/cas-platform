import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fromZonedTime } from 'date-fns-tz'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { buildCrowSystemPrompt, krEquityCrowBrief } from '../extra/crow'
import { planKrxFlowsCalls, t2BalanceDate } from '../korea-flows-data'
import {
  KR_FLOW_CROWDING_RULE,
  KR_FLOWS_NEWS_FALLBACK_LABEL,
  KR_FLOWS_NO_INTENT,
  computeKrFlowSignals,
  extractKrFlowsBlock,
  krFlowCrowdingLevel,
  krFlowSampleZ,
  logKrFlowsFallbackOnce,
  missingKrFlowSignals,
  planKrFlowsPacket,
  resetKrFlowsFallbackLogForTests,
  type KrFlowSignalRows,
} from '../korea-flows-signals'
import {
  KRX_DAILY_REFRESH,
  decideKrxDailyRefresh,
  runKrxDailyRefresh,
  type KrxDailyRefreshIo,
  type KrxRefreshLog,
} from '../krx-daily-refresh'
import { lastNKrxSessionDates, previousKrxSessionDate } from '../krx-calendar'

const ROOT = join(__dirname, '../../..')
const AS_OF = '2026-10-02'
const CODE = '005930'

function kst(ymd: string, hm: string): Date {
  return fromZonedTime(`${ymd} ${hm}:00`, 'Asia/Seoul')
}

function fixture(): KrFlowSignalRows {
  const sessions20 = lastNKrxSessionDates(AS_OF, 20)
  const sessions6 = lastNKrxSessionDates(AS_OF, 6)
  const balanceDate = previousKrxSessionDate(AS_OF, 2)
  const balanceBase = previousKrxSessionDate(balanceDate, 20)
  const holdingBase = previousKrxSessionDate(AS_OF, 20)
  const investors = ['foreign', 'institution', 'individual', 'pension', 'financial_investment'] as const
  const dailyNet: Record<(typeof investors)[number], (index: number) => number> = {
    foreign: () => 100,
    institution: (index) => (index >= 15 ? -50 : 50),
    individual: () => 10,
    pension: () => 7,
    financial_investment: () => 3,
  }
  const flows = sessions20.flatMap((date, index) =>
    investors.map((investor) => ({
      date,
      market: 'KOSPI',
      code: CODE,
      investor,
      netValue: dailyNet[investor](index),
    })),
  )
  const shorts = [
    ...sessions20.map((date) => ({
      date,
      market: 'KOSPI',
      code: CODE,
      shortRatio: date === AS_OF ? 4 : 2,
      balanceRatio: date === balanceDate ? 4.5 : null,
    })),
    {
      date: balanceBase,
      market: 'KOSPI',
      code: CODE,
      shortRatio: null,
      balanceRatio: 1.5,
    },
  ]
  const foreign = [
    { date: AS_OF, market: 'KOSPI', code: CODE, foreignHoldingRatio: 25.5 },
    { date: holdingBase, market: 'KOSPI', code: CODE, foreignHoldingRatio: 20 },
  ]
  const dailyDates = new Set([...sessions20, ...sessions6, holdingBase])
  const ratios = sessions20.map((date) => (date === AS_OF ? 4 : 2))
  const z = krFlowSampleZ(ratios)!
  return {
    market: 'KOSPI',
    code: CODE,
    asOf: AS_OF,
    flows,
    shorts,
    foreign,
    daily: [...dailyDates].map((date) => ({
      date,
      close: date === AS_OF ? 101 : 100,
      mktcap: date === AS_OF ? 1_000_000 : null,
    })),
    peers: {
      foreign5dAbsBp: [1, 2, 3, 4, 5],
      institution5dAbsBp: [1, 2, 2.5, 3, 9],
      shortZ: [0, 1, 2, 3, z],
    },
  }
}

describe('KR flow signal math', () => {
  it('sums windows, basis points, streaks, z-score, T+2 date, and percentiles', () => {
    const signals = computeKrFlowSignals(fixture())
    const foreign = signals.investors.find((row) => row.investor === 'foreign')!
    const institution = signals.investors.find((row) => row.investor === 'institution')!
    const individual = signals.investors.find((row) => row.investor === 'individual')!
    expect(foreign.net1d).toBe(100)
    expect(foreign.net5d).toBe(500)
    expect(foreign.net20d).toBe(2000)
    expect(foreign.bp5d).toBeCloseTo(5, 6)
    expect(foreign.bp20d).toBeCloseTo(20, 6)
    expect(institution.net1d).toBe(-50)
    expect(institution.net5d).toBe(-250)
    expect(institution.net20d).toBe(500)
    expect(institution.bp5d).toBeCloseTo(-2.5, 6)
    expect(individual.net5d).toBe(50)
    expect(signals.foreignStreak).toMatchObject({ side: 'net-buy', sessions: 20 })
    expect(signals.institutionStreak).toMatchObject({ side: 'net-sell', sessions: 5 })
    expect(signals.short.ratioToday).toBe(4)
    expect(signals.short.avg20d).toBeCloseTo(2.1, 6)
    expect(signals.short.z20d).toBeCloseTo(1.9 / Math.sqrt(0.2), 6)
    expect(signals.shortBalance.date).toBe(t2BalanceDate(AS_OF))
    expect(signals.shortBalance.date).toBe(previousKrxSessionDate(AS_OF, 2))
    expect(signals.shortBalance.ratio).toBe(4.5)
    expect(signals.shortBalance.change20dPp).toBeCloseTo(3, 6)
    expect(signals.shortBalance.dataAsOf).toBe(signals.shortBalance.date)
    expect(signals.foreignHolding.ratio).toBe(25.5)
    expect(signals.foreignHolding.change20dPp).toBeCloseTo(5.5, 6)
    expect(signals.ranks.foreign5dBpPercentile).toBe(100)
    expect(signals.ranks.institution5dBpPercentile).toBe(60)
    expect(signals.ranks.shortZPercentile).toBe(100)
    expect(signals.priceChange5dPct).toBeCloseTo(1, 6)
    expect(signals.flowsStale).toBe(false)
    expect(signals.crowdingLevel).toBe('high')
  })

  it('a zero net breaks the streak and a flat short ratio has no z-score', () => {
    const rows = fixture()
    const prior = previousKrxSessionDate(AS_OF, 1)
    for (const row of rows.flows) {
      if (row.investor === 'foreign' && row.date === prior) row.netValue = 0
    }
    for (const row of rows.shorts) row.shortRatio = 2
    const signals = computeKrFlowSignals(rows)
    expect(signals.foreignStreak).toMatchObject({ side: 'net-buy', sessions: 1 })
    expect(signals.short.z20d).toBeNull()
  })

  it('an 8% five-session move is high even with no flow rows', () => {
    const sessions6 = lastNKrxSessionDates(AS_OF, 6)
    const signals = computeKrFlowSignals({
      market: 'KOSPI',
      code: CODE,
      asOf: AS_OF,
      flows: [],
      shorts: [],
      foreign: [],
      daily: sessions6.map((date) => ({ date, close: date === AS_OF ? 92 : 100, mktcap: null })),
      peers: { foreign5dAbsBp: [], institution5dAbsBp: [], shortZ: [] },
    })
    expect(signals.priceChange5dPct).toBeCloseTo(-8, 6)
    expect(signals.crowdingLevel).toBe('high')
    expect(signals.flowsMissing).toBe(true)
  })
})

describe('crowdingLevel rule table', () => {
  const rule = KR_FLOW_CROWDING_RULE
  const base = {
    foreign5dBpPercentile: null,
    institution5dBpPercentile: null,
    shortZPercentile: null,
    foreignStreakSessions: 0,
    institutionStreakSessions: 0,
    abs5dPricePct: null,
  }
  it('uses only the named thresholds; missing inputs stay low', () => {
    expect(krFlowCrowdingLevel(base)).toBe('low')
    expect(krFlowCrowdingLevel({ ...base, foreign5dBpPercentile: rule.mediumPercentile - 0.1 })).toBe('low')
    expect(krFlowCrowdingLevel({ ...base, foreign5dBpPercentile: rule.mediumPercentile })).toBe('medium')
    expect(krFlowCrowdingLevel({ ...base, institution5dBpPercentile: rule.highPercentile })).toBe('high')
    expect(krFlowCrowdingLevel({ ...base, shortZPercentile: rule.highPercentile })).toBe('high')
    expect(krFlowCrowdingLevel({ ...base, foreignStreakSessions: rule.mediumStreakSessions })).toBe('medium')
    expect(krFlowCrowdingLevel({ ...base, institutionStreakSessions: rule.highStreakSessions })).toBe('high')
    expect(krFlowCrowdingLevel({ ...base, abs5dPricePct: rule.mediumAbs5dPricePct })).toBe('medium')
    expect(krFlowCrowdingLevel({ ...base, abs5dPricePct: rule.highAbs5dPricePct })).toBe('high')
    expect(
      krFlowCrowdingLevel({
        ...base,
        foreign5dBpPercentile: rule.mediumPercentile - 1,
        foreignStreakSessions: rule.mediumStreakSessions - 1,
        abs5dPricePct: rule.mediumAbs5dPricePct - 0.1,
      }),
    ).toBe('low')
  })
})

describe('KR flows packet section', () => {
  it('carries as-of dates, both sides, and the no-intent sentence', () => {
    const signals = computeKrFlowSignals(fixture())
    const plan = planKrFlowsPacket(signals, '삼성전자', CODE)
    expect(plan.fallbackReason).toBeNull()
    expect(plan.extraQuery).toBeNull()
    expect(plan.section).toContain(`Investor flows & positioning (KRX, as of ${AS_OF})`)
    expect(plan.section).toContain(KR_FLOWS_NO_INTENT)
    expect(plan.section).toContain(`as of ${signals.shortBalance.date} (T+2, its own date)`)
    expect(plan.section).toContain(`relative ranks (same market, as of ${AS_OF})`)
    expect(plan.section).toContain('crowdingLevel: high')
    expect(plan.section).toContain('argues higher close: foreign 5d net value positive')
    expect(plan.section).toContain('institution 5d net value negative')
    expect(plan.section).toContain('short-volume ratio z above its 20d history')
    expect(plan.section).not.toContain(KR_FLOWS_NEWS_FALLBACK_LABEL)
    expect(plan.section).not.toMatch(/세력|작전/)
    const wrapped = `PRICE\n\n${plan.section}\n\nresearch prose`
    expect(extractKrFlowsBlock(wrapped)).toBe(plan.section)
    expect(extractKrFlowsBlock(wrapped)).not.toContain('research prose')
  })

  it('uses the news fallback when flows are missing or stale, and the generate path does not fetch KRX', () => {
    const missing = missingKrFlowSignals({ market: 'KOSPI', code: CODE, asOf: AS_OF })
    const missingPlan = planKrFlowsPacket(missing, '삼성전자', CODE)
    expect(missingPlan.fallbackReason).toBe('missing')
    expect(missingPlan.extraQuery).toMatchObject({ lang: 'ko' })
    expect(missingPlan.extraQuery?.q).toContain('외국인')
    expect(missingPlan.extraQuery?.q).toContain(KR_FLOWS_NEWS_FALLBACK_LABEL)
    expect(missingPlan.section).toContain('argues higher close: none measured')
    expect(missingPlan.section).toContain('argues lower close: none measured')
    expect(missingPlan.section).toContain(`as of ${t2BalanceDate(AS_OF)}`)
    expect(missingPlan.section).toContain(`fallback: ${KR_FLOWS_NEWS_FALLBACK_LABEL}`)

    const staleRows = fixture()
    staleRows.flows = staleRows.flows.filter((row) => row.date !== AS_OF)
    const stale = computeKrFlowSignals(staleRows)
    expect(stale.flowsMissing).toBe(false)
    expect(stale.flowsStale).toBe(true)
    expect(stale.flowsDataAsOf).toBe(previousKrxSessionDate(AS_OF, 1))
    const stalePlan = planKrFlowsPacket(stale, '삼성전자', CODE)
    expect(stalePlan.fallbackReason).toBe('stale')
    expect(stalePlan.section).toContain(KR_FLOWS_NO_INTENT)
    expect(stalePlan.section).toContain('stale: yes')
    expect(stalePlan.extraQuery?.q).toContain(KR_FLOWS_NEWS_FALLBACK_LABEL)

    const stocks = readFileSync(join(__dirname, '../gateway/adapters/stocks.ts'), 'utf8')
    const loader = readFileSync(join(__dirname, '../korea-flows-load.ts'), 'utf8')
    expect(stocks).toContain('loadKrFlowSignals')
    expect(stocks).toContain('planKrFlowsPacket')
    expect(stocks).toContain('logKrFlowsFallbackOnce')
    expect(stocks).not.toContain('ensureKrxFlowsDay')
    expect(stocks).not.toContain('fetchKrxFlowsDay')
    expect(stocks).not.toContain('getKrxSession')
    expect(loader).not.toMatch(/ensureKrx|getKrxSession|fetchKrx|\bfetch\s*\(/)
    expect(loader).toContain(".gte('bas_dd', start)")
    expect(loader).toContain(".in('bas_dd', sessions5)")
    expect(loader).toContain(".in('bas_dd', sessions20)")
    expect(loader).not.toMatch(/for\s*\(\s*const date of[\s\S]{0,120}\.from\(/)
    expect(loader).toContain("'league_krx_flows'")
    expect(loader).toContain("'league_krx_short'")
    expect(loader).toContain("'league_krx_foreign_own'")
    expect(loader).toContain("'league_krx_daily'")

    resetKrFlowsFallbackLogForTests()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logKrFlowsFallbackOnce({ roundId: 'round-1', instrument: 'KRSTOCK:KOSPI:005930', asOf: AS_OF, reason: 'stale' })
    logKrFlowsFallbackOnce({ roundId: 'round-1', instrument: 'KRSTOCK:KOSPI:005930', asOf: AS_OF, reason: 'stale' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0]?.[0])).toContain('kr-flows-fallback round=round-1')
    expect(String(spy.mock.calls[0]?.[0])).not.toMatch(/password|KRX_ID|service_role|Bearer/i)
    spy.mockRestore()
  })
})

describe('KRX daily refresh', () => {
  it('matches the 16-request day plan and stays inside 18:00–23:00 KST', () => {
    expect(planKrxFlowsCalls(AS_OF)).toHaveLength(KRX_DAILY_REFRESH.flowsRequestsPerAttempt)
    expect(decideKrxDailyRefresh(kst(AS_OF, '17:59'), null)).toMatchObject({ action: 'skip', reason: 'outside_window' })
    expect(decideKrxDailyRefresh(kst(AS_OF, '18:00'), null)).toEqual({ action: 'fetch', date: AS_OF })
    expect(decideKrxDailyRefresh(kst(AS_OF, '22:59'), null)).toEqual({ action: 'fetch', date: AS_OF })
    expect(decideKrxDailyRefresh(kst(AS_OF, '23:00'), null)).toMatchObject({ action: 'skip', reason: 'outside_window' })
    expect(decideKrxDailyRefresh(kst('2026-10-03', '18:00'), null)).toMatchObject({
      action: 'skip',
      reason: 'not_session_day',
    })
    const recent = kst(AS_OF, '18:00').getTime()
    expect(
      decideKrxDailyRefresh(kst(AS_OF, '18:30'), { date: AS_OF, lastAttemptMs: recent, published: false }),
    ).toMatchObject({ action: 'skip', reason: 'hourly_backoff' })
    expect(
      decideKrxDailyRefresh(kst(AS_OF, '19:00'), { date: AS_OF, lastAttemptMs: recent, published: true }),
    ).toMatchObject({ action: 'skip', reason: 'published' })
  })

  it('fetches one bundle, then does nothing once stored, and retries at most hourly until 23:00', async () => {
    const published = harness()
    const first = await runKrxDailyRefresh(kst(AS_OF, '18:00'), published.io)
    expect(first).toMatchObject({ action: 'fetched', date: AS_OF, flowRequests: 16 })
    expect(published.calls).toEqual({ flows: 1, daily: 1 })
    const second = await runKrxDailyRefresh(kst(AS_OF, '18:10'), published.io)
    expect(second).toMatchObject({ action: 'skip', reason: 'published', flowRequests: 0 })
    expect(published.calls).toEqual({ flows: 1, daily: 1 })

    const waiting = harness({ publishOnFetch: false })
    await runKrxDailyRefresh(kst(AS_OF, '18:00'), waiting.io)
    await runKrxDailyRefresh(kst(AS_OF, '18:40'), waiting.io)
    expect(waiting.calls.flows).toBe(1)
    await runKrxDailyRefresh(kst(AS_OF, '19:00'), waiting.io)
    expect(waiting.calls.flows).toBe(2)
    await runKrxDailyRefresh(kst(AS_OF, '23:00'), waiting.io)
    expect(waiting.calls.flows).toBe(2)

    const stored = harness({ flows: true, daily: true })
    const already = await runKrxDailyRefresh(kst(AS_OF, '18:05'), stored.io)
    expect(already).toMatchObject({ action: 'already_stored', flowRequests: 0 })
    expect(stored.calls).toEqual({ flows: 0, daily: 0 })

    const flowsOnly = harness({ flows: true, daily: false })
    const dailyOnly = await runKrxDailyRefresh(kst(AS_OF, '18:05'), flowsOnly.io)
    expect(dailyOnly.flowRequests).toBe(0)
    expect(flowsOnly.calls).toEqual({ flows: 0, daily: 1 })

    let reads = 0
    const closed: KrxDailyRefreshIo = {
      readLog: async () => {
        reads += 1
        throw new Error('relation league_krx_refresh_log does not exist')
      },
      stored: async () => ({ flows: false, daily: false }),
      claimAttempt: async () => true,
      markPublished: async () => {},
      ensureFlows: async () => {
        throw new Error('must not fetch')
      },
      ensureDaily: async () => {
        throw new Error('must not fetch')
      },
    }
    const skipped = await runKrxDailyRefresh(kst(AS_OF, '18:00'), closed)
    expect(skipped).toMatchObject({ action: 'skip', reason: 'log_unavailable', flowRequests: 0 })
    expect(reads).toBe(1)

    const live = readFileSync(join(__dirname, '../krx-daily-refresh-live.ts'), 'utf8')
    const cron = readFileSync(join(ROOT, 'app/api/cron/league-generate/route.ts'), 'utf8')
    expect(live).toContain('ensureKrxFlowsDay')
    expect(live).toContain('ensureKrxDay')
    expect(live).not.toMatch(/\bfetch\s*\(/)
    expect(live).not.toMatch(/\bfor\s*\(/)
    expect(cron).toContain('refreshKrxDailyData')
    expect(cron).toContain('dispatchKrElectionAlerts')
  })
})

describe('crow Korean-equity lens', () => {
  it('states the 과열·쏠림 rules and forbids intent, 세력, 작전, manipulation, and coordinated activity', () => {
    const prompt = buildCrowSystemPrompt('stock', 'KRSTOCK:KOSPI:005930')
    expect(prompt).toContain('과열·쏠림 경계')
    expect(prompt).toContain('Forbidden')
    expect(prompt).toContain('세력')
    expect(prompt).toContain('작전')
    expect(prompt).toContain('manipulation')
    expect(prompt).toContain('coordinated activity')
    expect(prompt).toContain("any party's intent")
    expect(prompt).toContain('one-sided buying followed by profit-taking risk')
    expect(prompt).toContain('extended selling streaks')
    expect(prompt).toContain('short-ratio spikes')
    expect(prompt).toContain('price far above moving averages')
    expect(prompt).not.toContain('hypothesis you may raise')
    expect(buildCrowSystemPrompt('stock', 'STOCK:NASDAQ:AAPL')).toContain('hypothesis you may raise, never a fact')
    expect(buildCrowSystemPrompt('commodity')).toContain('hypothesis you may raise, never a fact')

    const section = planKrFlowsPacket(computeKrFlowSignals(fixture()), '삼성전자', CODE).section
    const brief = krEquityCrowBrief('PRICE PATH', section)
    expect(brief).toContain('과열·쏠림 경계 crowdingLevel: high')
    expect(brief).toContain(KR_FLOWS_NO_INTENT)
    expect(brief).not.toContain('hypothesis you may raise')

    const run = readFileSync(join(__dirname, '../extra/run.ts'), 'utf8')
    expect(run).toContain('buildCrowSystemPrompt(input.category, input.instrument)')
    expect(run).toContain('krEquityCrowBrief')
  })
})

function harness(initial?: { flows?: boolean; daily?: boolean; publishOnFetch?: boolean }) {
  const calls = { flows: 0, daily: 0 }
  let flows = initial?.flows ?? false
  let daily = initial?.daily ?? false
  let log: KrxRefreshLog = null
  const publishOnFetch = initial?.publishOnFetch !== false
  const io: KrxDailyRefreshIo = {
    readLog: async () => log,
    stored: async () => ({ flows, daily }),
    claimAttempt: async (date, atMs) => {
      log = { date, lastAttemptMs: atMs, published: false }
      return true
    },
    markPublished: async (date, atMs) => {
      log = { date, lastAttemptMs: atMs, published: true }
    },
    ensureFlows: async () => {
      calls.flows += 1
      if (publishOnFetch) flows = true
    },
    ensureDaily: async () => {
      calls.daily += 1
      if (publishOnFetch) daily = true
    },
  }
  return { calls, io }
}
