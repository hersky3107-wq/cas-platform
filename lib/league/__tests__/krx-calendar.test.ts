import { fromZonedTime } from 'date-fns-tz'
import { describe, expect, it } from 'vitest'
import { computeResolvesAt } from '../horizon'
import {
  isKrxTradingDay,
  KRX_HOLIDAYS,
  isProvisionalKrxDate,
  krxSessionCloseIso,
  lastCompletedKrxSession,
  nthFutureKrxSessionDate,
  previousKrxSessionDate,
  resolveKrxGradingSession,
} from '../krx-calendar'
import { resolveOpenPhase } from '../open-phase'

const KR = 'KRSTOCK:KOSPI:005930'
const TZ = 'Asia/Seoul'

function kst(ymd: string, hm: string): Date {
  return fromZonedTime(`${ymd} ${hm}:00`, TZ)
}

describe('KRX calendar + KRSTOCK session math', () => {
  it('Fri 2026-10-02 16:00 KST → anchor 2026-10-02; 1d resolves 2026-10-06 15:30 (skips Sat, Sun, 10-05)', () => {
    const now = kst('2026-10-02', '16:00')
    expect(lastCompletedKrxSession(now)).toEqual({ ok: true, date: '2026-10-02' })
    const r = computeResolvesAt('stock', '1d', now.toISOString(), KR)
    expect(r).toEqual({ ok: true, resolvesAt: krxSessionCloseIso('2026-10-06') })
    expect(r.ok && r.resolvesAt).toBe('2026-10-06T06:30:00.000Z')
  })

  it('Wed 2026-10-07 10:00 KST → anchor 2026-10-06; 1d → 2026-10-07 15:30', () => {
    const now = kst('2026-10-07', '10:00')
    expect(lastCompletedKrxSession(now)).toEqual({ ok: true, date: '2026-10-06' })
    const r = computeResolvesAt('stock', '1d', now.toISOString(), KR)
    expect(r).toEqual({ ok: true, resolvesAt: krxSessionCloseIso('2026-10-07') })
    expect(r.ok && r.resolvesAt).toBe('2026-10-07T06:30:00.000Z')
  })

  it('Thu 2026-10-08 16:00 KST → anchor 2026-10-08; 1d → 2026-10-12 (skips 10-09)', () => {
    const now = kst('2026-10-08', '16:00')
    expect(lastCompletedKrxSession(now)).toEqual({ ok: true, date: '2026-10-08' })
    const r = computeResolvesAt('stock', '1d', now.toISOString(), KR)
    expect(r).toEqual({ ok: true, resolvesAt: krxSessionCloseIso('2026-10-12') })
    expect(r.ok && r.resolvesAt).toBe('2026-10-12T06:30:00.000Z')
  })

  it('Wed 2026-12-30 16:00 KST → 1d → 2027-01-04 15:30 (skips 12-31, 01-01, weekend)', () => {
    const now = kst('2026-12-30', '16:00')
    expect(lastCompletedKrxSession(now)).toEqual({ ok: true, date: '2026-12-30' })
    expect(nthFutureKrxSessionDate('2026-12-30', 1)).toEqual({ ok: true, date: '2027-01-04' })
    const r = computeResolvesAt('stock', '1d', now.toISOString(), KR)
    expect(r).toEqual({ ok: true, resolvesAt: krxSessionCloseIso('2027-01-04') })
    expect(r.ok && r.resolvesAt).toBe('2027-01-04T06:30:00.000Z')
    expect(isProvisionalKrxDate('2027-01-04')).toBe(true)
  })

  it('Mon 2028-01-03 16:00 KST → 1d → krx_calendar_unverified', () => {
    const now = kst('2028-01-03', '16:00')
    expect(lastCompletedKrxSession(now)).toEqual({
      ok: false,
      reason: 'krx_calendar_unverified',
    })
    expect(nthFutureKrxSessionDate('2027-12-30', 1)).toEqual({
      ok: false,
      reason: 'krx_calendar_unverified',
    })
    expect(computeResolvesAt('stock', '1d', now.toISOString(), KR)).toEqual({
      ok: false,
      reason: 'krx_calendar_unverified',
    })
  })

  it('previousKrxSessionDate("2026-10-06", 2) → "2026-10-01"', () => {
    expect(previousKrxSessionDate('2026-10-06', 2)).toBe('2026-10-01')
  })

  it('US STOCK computeResolvesAt is unchanged at the same clocks (snapshot)', () => {
    const clocks = [
      { iso: kst('2026-10-02', '16:00').toISOString(), us: '2026-10-02T23:59:59.999Z' },
      { iso: kst('2026-10-07', '10:00').toISOString(), us: '2026-10-07T23:59:59.999Z' },
      { iso: kst('2026-10-08', '16:00').toISOString(), us: '2026-10-08T23:59:59.999Z' },
      { iso: kst('2026-12-30', '16:00').toISOString(), us: '2026-12-30T23:59:59.999Z' },
    ]
    for (const row of clocks) {
      expect(computeResolvesAt('stock', '1d', row.iso)).toEqual({ ok: true, resolvesAt: row.us })
      expect(computeResolvesAt('stock', '1d', row.iso, 'AAPL')).toEqual({ ok: true, resolvesAt: row.us })
      expect(computeResolvesAt('stock', '1d', row.iso, 'STOCK:NASDAQ:AAPL')).toEqual({
        ok: true,
        resolvesAt: row.us,
      })
    }
  })

  it('2026-06-03 (local election) and 2026-07-17 (제헌절) are KRX holidays', () => {
    expect(KRX_HOLIDAYS.has('2026-06-03')).toBe(true)
    expect(KRX_HOLIDAYS.has('2026-07-17')).toBe(true)
    expect(isKrxTradingDay('2026-06-03')).toBe(false)
    expect(isKrxTradingDay('2026-07-17')).toBe(false)
    const afterElection = kst('2026-06-02', '16:00')
    expect(lastCompletedKrxSession(afterElection)).toEqual({ ok: true, date: '2026-06-02' })
    expect(nthFutureKrxSessionDate('2026-06-02', 1)).toEqual({ ok: true, date: '2026-06-04' })
    const afterConstitution = kst('2026-07-16', '16:00')
    expect(lastCompletedKrxSession(afterConstitution)).toEqual({ ok: true, date: '2026-07-16' })
    expect(nthFutureKrxSessionDate('2026-07-16', 1)).toEqual({ ok: true, date: '2026-07-20' })
  })

  it('open-phase reports closed on 2026-10-05 and 2026-10-09 (KRX holidays)', () => {
    expect(isKrxTradingDay('2026-10-05')).toBe(false)
    expect(isKrxTradingDay('2026-10-09')).toBe(false)
    const midday = '12:00'
    expect(resolveOpenPhase(KR, kst('2026-10-05', midday))).toBe('weekend')
    expect(resolveOpenPhase(KR, kst('2026-10-09', midday))).toBe('weekend')
    expect(resolveOpenPhase('005930.KS', kst('2026-10-05', midday))).toBe('weekend')
  })
})

describe('resolveKrxGradingSession', () => {
  it('returns the date unchanged when it is a trading day', () => {
    expect(resolveKrxGradingSession('2026-10-06', isKrxTradingDay)).toBe('2026-10-06')
  })

  it('walks back when resolvesAtDate is not a trading day (holiday / 임시공휴일)', () => {
    expect(resolveKrxGradingSession('2026-10-09', isKrxTradingDay)).toBe('2026-10-08')
    const withTempHoliday = (d: string) => d !== '2026-10-06' && isKrxTradingDay(d)
    expect(resolveKrxGradingSession('2026-10-06', withTempHoliday)).toBe('2026-10-02')
  })
})
