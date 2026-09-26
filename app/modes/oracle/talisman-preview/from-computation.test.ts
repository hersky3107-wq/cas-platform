import { describe, expect, it } from 'vitest'
import { computeTalisman } from '@/lib/oracle/talisman'
import { ziweiChart } from '@/lib/oracle/engines/ziwei'
import { palacesFrom, specFromComputation } from './from-computation'
import { constructedSinkang } from './constructed'
import { charts1988, fakeConsensus, LIVE_ACCESS } from '@/lib/oracle/talisman/__tests__/fixture'

describe('palacesFrom ziwei ring signals', () => {
  it('reads 살성 count, 主星 brightness, 化忌, and 대한 from the sanitized chart', () => {
    const charts = charts1988({
      ziwei: ziweiChart({
        birthDate: '1988-03-15',
        birthTime: '04:30',
        tz: 'Asia/Seoul',
        sex: 'male',
        atDate: '2026-08-15',
      }),
    })
    const computation = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ water: 8 }),
    })
    expect(computation).not.toBeNull()
    const palaces = palacesFrom(computation!, charts)
    expect(palaces).toHaveLength(12)
    expect(palaces!.some((palace) => palace.maleficCount > 0)).toBe(true)
    expect(palaces!.some((palace) => palace.brightness === 'solid' || palace.brightness === 'faint')).toBe(true)
    expect(palaces!.filter((palace) => palace.daXian)).toHaveLength(1)
    const sealedHuaJi = palaces!.filter((palace) => palace.sealed)
    expect(sealedHuaJi.every((palace) => palace.huaJi === false)).toBe(true)
    expect(palaces!.filter((palace) => palace.huaJi && palace.sealed)).toHaveLength(0)
    const spec = specFromComputation(computation!, charts, { sessionId: 'test', dateLabel: '2026.08.15' })
    expect(spec.palaces).toEqual(palaces)
    expect(computation!.seals.every((seal) =>
      seal.kind === 'ninestar-killing' ||
      seal.kind === 'ziwei-malefic' ||
      seal.kind === 'ziwei-huaji' ||
      seal.kind === 'name-daehyung',
    )).toBe(true)
  })

  it('marks 空宮 from the raw chart, not the seal-subtracted layer', () => {
    const charts = charts1988()
    const computation = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ water: 8 }),
    })
    const palaces = palacesFrom(computation!, charts)
    const rawEmpty = charts.ziwei?.palaces.filter((palace) => !palace.stars.some((star) => star.category === 'major')) ?? []
    expect(palaces!.filter((palace) => palace.empty)).toHaveLength(rawEmpty.length)
  })
})

describe('constructed 신강 preview fixture', () => {
  it('drains from 억부 용신', () => {
    const { spec, stats } = constructedSinkang()
    expect(stats.centreSource).toBe('eokbu')
    expect(stats.centreMode).toBe('drain')
    expect(spec.mode).toBe('drain')
    expect(spec.palaces).toHaveLength(12)
    expect(spec.palaces?.some((palace) => palace.daXian)).toBe(true)
  })
})
