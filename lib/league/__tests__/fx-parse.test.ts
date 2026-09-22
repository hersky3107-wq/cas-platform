import { describe, expect, it } from 'vitest'
import {
  CFTC_AUD_CODE,
  CFTC_DXY_CODE,
  CFTC_EUR_CODE,
  CFTC_GBP_CODE,
  CFTC_JPY_CODE,
  CFTC_LEGACY_SOURCE,
  CFTC_TFF_SOURCE,
  cotFromLegacyText,
  cotFromTffText,
  parseCftcLegacyNonComm,
  parseCftcTffLeveragedFunds,
} from '../fx-parse'

/** First 16 columns of FinFutWk.txt EURO FX 2026-09-15 (leveraged-funds at 14/15). */
const EUR_TFF =
  '"EURO FX - CHICAGO MERCANTILE EXCHANGE",260915,2026-09-15,099741,CME ,00,099 ,  920035,   41113,  299193,    5144,  486435,  234737,   43899,  103260,  131416,'

const EUR_LEGACY =
  '"EURO FX - CHICAGO MERCANTILE EXCHANGE",260915,2026-09-15,099741,CME ,00,099 ,  920035,  209000,  235993,'

const JPY_TFF =
  '"JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",260915,2026-09-15,097741,CME ,00,097 ,  542802,   48596,  217166,    3064,  118873,   65028,    7122,  110000,   50000,'

describe('CFTC FX TFF leveraged-funds parser', () => {
  it('parses EURO FX 099741 leveraged-funds net from FinFutWk layout', () => {
    expect(parseCftcTffLeveragedFunds(EUR_TFF, CFTC_EUR_CODE)).toEqual({
      contract: 'EURO FX - CHICAGO MERCANTILE EXCHANGE',
      date: '2026-09-15',
      openInterest: 920035,
      managedMoneyLong: 103260,
      managedMoneyShort: 131416,
      managedMoneyNet: -28156,
      source: CFTC_TFF_SOURCE,
    })
  })

  it('does not match a different contract code', () => {
    expect(parseCftcTffLeveragedFunds(EUR_TFF, CFTC_JPY_CODE)).toBeNull()
  })

  it('parses JPY 097741 and AUD/DXY/GBP codes from a combined blob', () => {
    const blob = [
      EUR_TFF,
      JPY_TFF,
      '"BRITISH POUND - CHICAGO MERCANTILE EXCHANGE",260915,2026-09-15,096742,CME ,00,096 ,  314293,  1,  2,  0,  3,  4,  0,  69331,  128046,',
      '"AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",260915,2026-09-15,232741,CME ,00,232 ,  493141,  1,  2,  0,  3,  4,  0,  114312,  153218,',
      '"USD INDEX - ICE FUTURES U.S.",260915,2026-09-15,098662,ICUS,01,098 ,   43744,  1,  2,  0,  3,  4,  0,   25971,   15378,',
    ].join('\n')
    expect(cotFromTffText(blob, CFTC_JPY_CODE)).toMatchObject({ managedMoneyNet: 60000, openInterest: 542802 })
    expect(cotFromTffText(blob, CFTC_GBP_CODE)).toMatchObject({ managedMoneyNet: -58715 })
    expect(cotFromTffText(blob, CFTC_AUD_CODE)).toMatchObject({ managedMoneyNet: -38906 })
    expect(cotFromTffText(blob, CFTC_DXY_CODE)).toMatchObject({ managedMoneyNet: 10593 })
    expect(cotFromTffText(blob, '048601')).toMatchObject({
      unavailable: expect.stringContaining('no TFF row'),
    })
  })
})

describe('CFTC FX legacy non-commercial parser', () => {
  it('parses EURO FX non-commercial net from deafut layout', () => {
    expect(parseCftcLegacyNonComm(EUR_LEGACY, CFTC_EUR_CODE)).toEqual({
      contract: 'EURO FX - CHICAGO MERCANTILE EXCHANGE',
      date: '2026-09-15',
      openInterest: 920035,
      managedMoneyLong: 209000,
      managedMoneyShort: 235993,
      managedMoneyNet: -26993,
      source: CFTC_LEGACY_SOURCE,
    })
  })

  it('cotFromLegacyText finds the row in a blob', () => {
    expect(cotFromLegacyText(EUR_LEGACY, CFTC_EUR_CODE)).toMatchObject({ managedMoneyNet: -26993 })
    expect(cotFromLegacyText(EUR_LEGACY, CFTC_JPY_CODE)).toMatchObject({
      unavailable: expect.stringContaining('no legacy row'),
    })
  })
})
