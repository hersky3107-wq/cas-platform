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

  it('keeps tarot card names, rune names, sukuyou relations, and tzolkin nawal names', () => {
    const tarotRow = {
      system: 'tarot',
      engine_version: 'tarot-1',
      axes: {},
      result: {
        draw: {
          cards: [{ id: 0, name: 'The Fool', reversed: false }],
        },
      },
    } as unknown as OracleComputation
    expect(publicComputation(tarotRow).calculation).toEqual({
      draw: {
        cards: [{ id: 0, name: 'The Fool', reversed: false }],
      },
    })

    const runesRow = {
      system: 'runes',
      engine_version: 'runes-1',
      axes: {},
      result: {
        draw: {
          runes: [{ id: 1, name: 'Fehu', glyph: 'ᚠ' }],
        },
      },
    } as unknown as OracleComputation
    expect(publicComputation(runesRow).calculation).toEqual({
      draw: {
        runes: [{ id: 1, name: 'Fehu', glyph: 'ᚠ' }],
      },
    })

    const sukuyouRow = {
      system: 'sukuyou',
      engine_version: 'sukuyou-1',
      axes: {},
      result: {
        natal: { index: 1, hanja: '昴', hangul: '모' },
        sukuyouRelation: { offset: 0, name: '命', pair: '命' },
      },
    } as unknown as OracleComputation
    expect(publicComputation(sukuyouRow).calculation).toEqual({
      natal: { index: 1, hanja: '昴', hangul: '모' },
      sukuyouRelation: { offset: 0, name: '命', pair: '命' },
    })

    const tzolkinRow = {
      system: 'tzolkin',
      engine_version: 'tzolkin-1',
      axes: {},
      result: {
        natal: { nawal: 18, nawalName: "Etz'nab'", tone: 2 },
      },
    } as unknown as OracleComputation
    expect(publicComputation(tzolkinRow).calculation).toEqual({
      natal: { nawal: 18, nawalName: "Etz'nab'", tone: 2 },
    })
  })

  it('keeps name engine stroke breakdown and subject glyphs', () => {
    const nameRow = {
      system: 'name',
      engine_version: 'name-1',
      axes: {},
      result: {
        reading: { supported: true, strokes: [9, 6, 8] },
        subject: { written: '홍길동', glyphs: ['홍', '길', '동'] },
      },
    } as unknown as OracleComputation
    expect(publicComputation(nameRow).calculation).toEqual({
      reading: { supported: true, strokes: [9, 6, 8] },
      subject: { written: '홍길동', glyphs: ['홍', '길', '동'] },
    })
  })

  it('drops unallowlisted root keys and all PII attributes', () => {
    const contaminatedRow = {
      system: 'saju',
      engine_version: 'saju-1',
      axes: {},
      result: {
        pillars: { day: { ganzhi: '甲子' } },
        raw_profile: { birthDate: '1990-01-01', lat: 37.5, lng: 127.0 },
        user_info: { fullName: '홍길동', email: 'test@example.com', phone: '010-1234-5678' },
      },
    } as unknown as OracleComputation

    const sanitized = publicComputation(contaminatedRow)
    expect(sanitized.calculation).toEqual({
      pillars: { day: { ganzhi: '甲子' } },
    })
    expect(JSON.stringify(sanitized)).not.toContain('1990-01-01')
    expect(JSON.stringify(sanitized)).not.toContain('test@example.com')
    expect(JSON.stringify(sanitized)).not.toContain('010-1234-5678')
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
