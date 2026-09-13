import { describe, expect, it } from 'vitest'
import {
  activeLanguageDirective,
  KOREAN_ONLY_DIRECTIVE,
  localeFromPersistedState,
  localeFromWriteInLine,
  runWithOutputLanguage,
} from '../output-language'

describe('MOTIE output-language lock', () => {
  it('defaults to the historic Korean lock when ALS is empty', () => {
    expect(activeLanguageDirective()).toBe(KOREAN_ONLY_DIRECTIVE)
  })

  it('switches the system lock to English inside a league hop', async () => {
    await runWithOutputLanguage('en', async () => {
      expect(activeLanguageDirective()).not.toBe(KOREAN_ONLY_DIRECTIVE)
      expect(activeLanguageDirective().toLowerCase()).toContain('english')
      expect(activeLanguageDirective()).not.toContain('한국어')
    })
    expect(activeLanguageDirective()).toBe(KOREAN_ONLY_DIRECTIVE)
  })

  it('recovers locale from Write in X. when the persisted field is missing', () => {
    expect(localeFromWriteInLine('Write in English.\nProposition: gold')).toBe('en')
    expect(localeFromWriteInLine('Write in Korean.\n')).toBe('ko')
    expect(localeFromPersistedState({ question: 'Write in English.\nProposition: gold' })).toBe('en')
    expect(localeFromPersistedState({ outputLanguage: 'ko', question: 'Write in English.' })).toBe('ko')
    expect(localeFromPersistedState({ outputLanguage: 'en' })).toBe('en')
  })
})
