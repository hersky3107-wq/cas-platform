import { describe, expect, it } from 'vitest'
import { NUMEROLOGY_ENGINE_VERSION, numerology, reducePythagorean } from '..'

describe('numerology engine version', () => {
  it('exports NUMEROLOGY_ENGINE_VERSION', () => {
    expect(NUMEROLOGY_ENGINE_VERSION).toBe('1.0.0')
  })
})

describe('numerology determinism', () => {
  it('returns the identical result 1000 times for the same inputs', () => {
    const input = { birthDate: '2009-11-07', latinName: 'Ada Lovelace', atDate: '2026-08-15' }
    const first = numerology(input)
    for (let i = 0; i < 1000; i++) {
      expect(numerology(input)).toEqual(first)
    }
  })
})

describe('master numbers', () => {
  it('preserves a life path that reduces to 11', () => {
    // 11 (month) + 7 (day) + 11 (year 2009) = 29 → 11
    const result = numerology({ birthDate: '2009-11-07', atDate: '2026-01-01' })
    expect(result.lifePath).toBe(11)
    expect(reducePythagorean(11)).toBe(11)
    expect(reducePythagorean(22)).toBe(22)
    expect(reducePythagorean(33)).toBe(33)
  })

  it('preserves birthday number 11 for day 29', () => {
    const result = numerology({ birthDate: '1990-03-29', atDate: '2026-01-01' })
    expect(result.birthdayNumber).toBe(11)
  })
})

describe('missing latin name', () => {
  it('returns null name numbers and no_latin_name when latinName is absent', () => {
    const result = numerology({ birthDate: '1990-03-29', atDate: '2026-08-15' })
    expect(result.expression).toBeNull()
    expect(result.soulUrge).toBeNull()
    expect(result.personality).toBeNull()
    expect(result.limitations).toEqual(['no_latin_name'])
  })

  it('does not guess from a Korean-only name', () => {
    const result = numerology({ birthDate: '1990-03-29', latinName: '김민수', atDate: '2026-08-15' })
    expect(result.expression).toBeNull()
    expect(result.limitations).toEqual(['no_latin_name'])
  })
})

describe('name numbers', () => {
  it('computes Pythagorean expression / soul urge / personality', () => {
    const result = numerology({ birthDate: '1990-01-01', latinName: 'John', atDate: '2026-01-01' })
    expect(result.expression).toBe(2)
    expect(result.soulUrge).toBe(6)
    expect(result.personality).toBe(5)
    expect(result.limitations).toEqual([])
  })
})
