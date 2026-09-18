import { describe, expect, it } from 'vitest'
import type { OracleComputation } from '../../schema'
import { SINGLE_SYSTEMS } from '../../single-system-ui'
import { publicComputation } from '../public-computation'

describe('publicComputation', () => {
  it('exposes calculation data but recursively strips profile identity and location fields', () => {
    const row = {
      system: 'astro',
      engine_version: 'astro-1',
      axes: { traits: { drive: 61 } },
      result: {
        natal: {
          sun: 'Aries',
          birthDate: '1988-03-15',
          nested: {
            timezone: 'Asia/Seoul',
            latitude: 37.5,
            house: 4,
          },
        },
      },
    } as unknown as OracleComputation

    const view = publicComputation(row)

    expect(view.calculation).toEqual({
      natal: {
        sun: 'Aries',
        nested: { house: 4 },
      },
    })
    expect(JSON.stringify(view)).not.toContain('1988-03-15')
    expect(JSON.stringify(view)).not.toContain('Asia/Seoul')
    expect(JSON.stringify(view)).not.toContain('37.5')
  })

  it('keeps natal body ecliptic longitude so the wheel can place planets', () => {
    const row = {
      system: 'astro',
      engine_version: 'astro-1',
      axes: {},
      result: {
        natal: {
          bodies: {
            Sun: { longitude: 162.87, sign: 'Virgo', degreeInSign: 12.87 },
          },
          nested: {
            longitude: 126.98,
            latitude: 37.56,
            house: 4,
          },
        },
      },
    } as unknown as OracleComputation

    const view = publicComputation(row)
    expect(view.calculation).toEqual({
      natal: {
        bodies: {
          Sun: { longitude: 162.87, sign: 'Virgo', degreeInSign: 12.87 },
        },
        nested: { house: 4 },
      },
    })
  })

  it('keeps 자미두수 palace and star names so a 명반 can render', () => {
    const row = {
      system: 'ziwei',
      engine_version: 'ziwei-1',
      axes: {},
      result: {
        chart: {
          palaces: [{ index: 2, branch: '寅', name: '命', stars: [{ name: '武曲', category: 'major' }] }],
          wuXingJu: { name: '木三局' },
        },
      },
    } as unknown as OracleComputation

    const view = publicComputation(row)
    expect(JSON.stringify(view.calculation)).toContain('命')
    expect(JSON.stringify(view.calculation)).toContain('武曲')
  })

  it('keeps PRISM cycle names and top-level colour picks', () => {
    const row = {
      system: 'prism',
      engine_version: 'prism-1',
      axes: {},
      result: {
        prism: { annualCycle: { name: 'Harvest' }, opportunityDomain: 'social' },
        colors: { impulse: 'sand', need: 'scarlet', identity: 'silver' },
      },
    } as unknown as OracleComputation

    const view = publicComputation(row)
    expect(view.calculation).toMatchObject({
      prism: { annualCycle: { name: 'Harvest' }, opportunityDomain: 'social' },
      colors: { impulse: 'sand', need: 'scarlet', identity: 'silver' },
    })
  })

  it('never exposes ai_payload or model identity', () => {
    const row = {
      system: 'saju',
      engine_version: 'saju-1',
      axes: {},
      result: { pillars: { day: '甲' } },
      ai_payload: { model: 'secret-model', prompt: 'secret' },
    } as unknown as OracleComputation

    const view = publicComputation(row)
    expect(Object.keys(view).sort()).toEqual(['axes', 'calculation', 'engineVersion', 'system', 'unreadable'])
    expect(JSON.stringify(view)).not.toContain('secret-model')
  })
})

describe('single-system UI catalog', () => {
  it('contains all 12 systems including PRISM, each with four Korean explanation lines', () => {
    expect(SINGLE_SYSTEMS).toHaveLength(12)
    expect(SINGLE_SYSTEMS.map((system) => String(system.id))).toContain('prism')
    for (const system of SINGLE_SYSTEMS) {
      expect(system.explanation).toHaveLength(4)
      expect(system.explanation.every((line) => /[가-힣]/.test(line))).toBe(true)
    }
  })
})
