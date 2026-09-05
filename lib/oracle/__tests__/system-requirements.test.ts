import { describe, expect, it } from 'vitest'
import {
  isDrawBasedSystem,
  missingRequiredFields,
  profileFieldsToShow,
  readingPath,
  readingStorageKey,
  requiredProfileFields,
} from '../system-requirements'

describe('system requirements', () => {
  it('asks draw-based systems for no birth fields', () => {
    for (const system of ['tarot', 'runes', 'iching'] as const) {
      expect(isDrawBasedSystem(system)).toBe(true)
      expect(requiredProfileFields(system)).toEqual([])
      expect(missingRequiredFields(system, {})).toEqual([])
    }
  })

  it('asks astro for a birth city and saju/ziwei for sex', () => {
    expect(requiredProfileFields('astro')).toEqual(['birth_date', 'birth_place'])
    expect(requiredProfileFields('saju')).toEqual(['birth_date', 'sex'])
    expect(requiredProfileFields('ziwei')).toEqual(['birth_date', 'sex'])
  })

  it('asks PRISM for date + MBTI and name for a stored name only', () => {
    expect(requiredProfileFields('prism')).toEqual(['birth_date', 'mbti'])
    expect(requiredProfileFields('name')).toEqual(['name'])
    expect(requiredProfileFields('tzolkin')).toEqual(['birth_date'])
    expect(requiredProfileFields('numerology')).toEqual(['birth_date'])
  })

  it('treats a placeholder stub date as missing a real birth date', () => {
    expect(
      missingRequiredFields('saju', {
        birth_date: '1970-01-01',
        sex: 'F',
        placeholderBirthDate: true,
      }),
    ).toEqual(['birth_date'])
    expect(
      missingRequiredFields('tarot', {
        birth_date: '1970-01-01',
        placeholderBirthDate: true,
      }),
    ).toEqual([])
  })

  it('does not re-ask held fields', () => {
    expect(
      missingRequiredFields('astro', {
        birth_date: '1988-03-15',
        birth_city: 'Busan',
      }),
    ).toEqual([])
    expect(
      missingRequiredFields('prism', {
        birth_date: '1988-03-15',
        mbti: 'INTJ',
      }),
    ).toEqual([])
  })

  it('keeps Fate as the saju alias and shares its session storage key', () => {
    expect(readingPath('saju')).toBe('/modes/oracle/fate')
    expect(readingPath('tarot')).toBe('/modes/oracle/read/tarot')
    expect(readingStorageKey('saju')).toBe('oracle.fate.active-session')
    expect(readingStorageKey('prism')).toBe('oracle.read.prism.active-session')
  })

  it('shows only missing fields when the profile is reached from a gate', () => {
    expect(profileFieldsToShow('astro', ['birth_place'])).toEqual(['birth_place'])
    expect(profileFieldsToShow('numerology', [])).toEqual(['birth_date', 'name_latin'])
    expect(profileFieldsToShow(null, [])).toBe('full')
  })
})
