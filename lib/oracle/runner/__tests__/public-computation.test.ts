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
  it('contains exactly the 11 non-prism systems with four Korean explanation lines each', () => {
    expect(SINGLE_SYSTEMS).toHaveLength(11)
    expect(SINGLE_SYSTEMS.map((system) => String(system.id))).not.toContain('prism')
    for (const system of SINGLE_SYSTEMS) {
      expect(system.explanation).toHaveLength(4)
      expect(system.explanation.every((line) => /[가-힣]/.test(line))).toBe(true)
    }
  })
})
