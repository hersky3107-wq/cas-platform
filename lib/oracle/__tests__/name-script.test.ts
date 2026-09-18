import { describe, expect, it } from 'vitest'
import {
  composeStoredName,
  inferNameScript,
  inferNameScriptFromText,
  nameEngineLocale,
  nameScriptFromLocaleTag,
  splitNameFields,
} from '../name-script'

describe('name script storage', () => {
  it('writes Hangul to name_local and clears the other columns', () => {
    expect(composeStoredName('김', '지수', 'hangul')).toEqual({
      name_local: '김지수',
      name_hanja: null,
      name_latin: null,
    })
  })

  it('writes Hanja/Kanji to both display and 획수 columns', () => {
    expect(composeStoredName('金', '智秀', 'hanja')).toEqual({
      name_local: '金智秀',
      name_hanja: '金智秀',
      name_latin: null,
    })
    expect(composeStoredName('佐藤', '太郎', 'ja')).toEqual({
      name_local: '佐藤太郎',
      name_hanja: '佐藤太郎',
      name_latin: null,
    })
  })

  it('writes Latin given-then-family into name_latin only', () => {
    expect(composeStoredName('Kim', 'Minseo', 'latin')).toEqual({
      name_local: null,
      name_hanja: null,
      name_latin: 'Minseo Kim',
    })
  })

  it('round-trips Latin through the same two fields', () => {
    const stored = composeStoredName('Garcia', 'Maria Elena', 'latin')
    expect(splitNameFields('latin', stored.name_local, stored.name_hanja, stored.name_latin)).toEqual({
      surname: 'Garcia',
      given: 'Maria Elena',
    })
  })

  it('maps script to the engine locale the 성명학 branch expects', () => {
    expect(nameEngineLocale('hangul')).toBe('ko')
    expect(nameEngineLocale('hanja')).toBe('zh')
    expect(nameEngineLocale('ja')).toBe('ja')
    expect(nameEngineLocale('latin')).toBe('en')
  })

  it('prefers the stored derived script over column inference', () => {
    expect(
      inferNameScript({
        name_local: '김지수',
        name_hanja: null,
        name_latin: 'Jisoo Kim',
        derived: { name_script: 'latin' },
      }),
    ).toBe('latin')
  })

  it('infers Hangul / Hanja / Latin from the filled column when derived is empty', () => {
    expect(inferNameScript({ name_local: '김지수', name_hanja: null, name_latin: null, derived: {} })).toBe(
      'hangul',
    )
    expect(inferNameScript({ name_local: null, name_hanja: '金智秀', name_latin: null, derived: {} })).toBe(
      'hanja',
    )
    expect(inferNameScript({ name_local: null, name_hanja: null, name_latin: 'Ada Lovelace', derived: {} })).toBe(
      'latin',
    )
  })

  it('reads a legacy name_locale tag', () => {
    expect(nameScriptFromLocaleTag('ko')).toBe('hangul')
    expect(nameScriptFromLocaleTag('ja-JP')).toBe('ja')
    expect(nameScriptFromLocaleTag('zh-TW')).toBe('hanja')
    expect(nameScriptFromLocaleTag('en')).toBe('latin')
  })

  it('classifies a raw partner name by script', () => {
    expect(inferNameScriptFromText('박민준')).toBe('hangul')
    expect(inferNameScriptFromText('たろう')).toBe('ja')
    expect(inferNameScriptFromText('金智秀')).toBe('hanja')
    expect(inferNameScriptFromText('Elena Rossi')).toBe('latin')
  })
})
