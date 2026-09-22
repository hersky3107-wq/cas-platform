import { describe, expect, it } from 'vitest'
import {
  CFTC_ES_CODE,
  CFTC_NIKKEI_YEN_CODE,
  CFTC_NQ_CODE,
  CFTC_VIX_CODE,
  CFTC_YM_CODE,
  classifyIndexEtfInstrument,
  cotFromTffText,
  indexEtfFieldPlan,
} from '../index-etf-parse'

const ES_TFF =
  '"E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",260915,2026-09-15,13874A,CME ,00,138 , 2446519,   1,  2,  0,  3,  4,  0,  100000,  393143,'
const NQ_TFF =
  '"NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE",260915,2026-09-15,209742,CME ,00,209 ,  325784,   1,  2,  0,  3,  4,  0,    1000,    7387,'
const YM_TFF =
  '"DJIA x $5 - CHICAGO BOARD OF TRADE",260915,2026-09-15,124603,CBT ,00,124 ,  101191,   1,  2,  0,  3,  4,  0,    1000,    3437,'
const NK_TFF =
  '"NIKKEI STOCK AVERAGE YEN DENOM - CHICAGO MERCANTILE EXCHANGE",260915,2026-09-15,240743,CME ,00,240 ,   22625,   1,  2,  0,  3,  4,  0,    1969,    1000,'
const VIX_TFF =
  '"VIX FUTURES - CBOE FUTURES EXCHANGE",260915,2026-09-15,1170E1,CFE ,00,117 ,  446060,   1,  2,  0,  3,  4,  0,    1000,   17504,'

describe('index_etf field plan isolation', () => {
  it('classifies Layer 1 and Layer 2 tickers', () => {
    expect(classifyIndexEtfInstrument('SPY')).toBe('spy')
    expect(classifyIndexEtfInstrument('TQQQ')).toBe('tqqq')
    expect(classifyIndexEtfInstrument('XAU/USD')).toBeNull()
  })

  it('TQQQ/SQQQ get NQ + VIX, not ES; UPRO/SPXU get ES not NQ; SOXL gets neither', () => {
    const tqqq = indexEtfFieldPlan('TQQQ')!
    expect(tqqq.cotNq).toBe(true)
    expect(tqqq.cotEs).toBe(false)
    expect(tqqq.fredIndex).toBe('NASDAQCOM')
    expect(tqqq.vixcls).toBe(true)
    expect(indexEtfFieldPlan('SQQQ')!.cotNq).toBe(true)
    expect(indexEtfFieldPlan('SQQQ')!.cotEs).toBe(false)

    const upro = indexEtfFieldPlan('UPRO')!
    expect(upro.cotEs).toBe(true)
    expect(upro.cotNq).toBe(false)
    expect(upro.fredIndex).toBe('SP500')
    expect(indexEtfFieldPlan('SPY')!.cotEs).toBe(true)

    const soxl = indexEtfFieldPlan('SOXL')!
    expect(soxl.cotEs).toBe(false)
    expect(soxl.cotNq).toBe(false)
    expect(soxl.fredIndex).toBeNull()
    expect(soxl.cotGapNote).toMatch(/not ES\/NQ/)
  })

  it('EWY/EWT/FEZ have no cash print and an honest no-COT note; EWJ gets Nikkei', () => {
    expect(indexEtfFieldPlan('EWY')!.cotGapNote).toMatch(/KOSPI/)
    expect(indexEtfFieldPlan('EWY')!.fredIndex).toBeNull()
    expect(indexEtfFieldPlan('EWT')!.cotGapNote).toMatch(/Taiwan/)
    expect(indexEtfFieldPlan('FEZ')!.cotGapNote).toMatch(/EURO STOXX/)
    expect(indexEtfFieldPlan('EWJ')!.fredIndex).toBe('NIKKEI225')
    expect(indexEtfFieldPlan('EWJ')!.cotNikkei).toBe(true)
    expect(indexEtfFieldPlan('DIA')!.fredIndex).toBe('DJIA')
    expect(indexEtfFieldPlan('DIA')!.cotYm).toBe(true)
  })
})

describe('CFTC index TFF codes reuse the FX FinFutWk parser', () => {
  it('parses ES / NQ / YM / Nikkei / VIX from a combined blob', () => {
    const blob = [ES_TFF, NQ_TFF, YM_TFF, NK_TFF, VIX_TFF].join('\n')
    expect(cotFromTffText(blob, CFTC_ES_CODE)).toMatchObject({ managedMoneyNet: -293143, openInterest: 2446519 })
    expect(cotFromTffText(blob, CFTC_NQ_CODE)).toMatchObject({ managedMoneyNet: -6387, openInterest: 325784 })
    expect(cotFromTffText(blob, CFTC_YM_CODE)).toMatchObject({ managedMoneyNet: -2437, openInterest: 101191 })
    expect(cotFromTffText(blob, CFTC_NIKKEI_YEN_CODE)).toMatchObject({ managedMoneyNet: 969, openInterest: 22625 })
    expect(cotFromTffText(blob, CFTC_VIX_CODE)).toMatchObject({ managedMoneyNet: -16504, openInterest: 446060 })
  })
})
