import { describe, expect, it } from 'vitest'
import type { CardModelPrediction } from '../card-types'
import {
  isNativeKoreanText,
  isRationaleTranslationPending,
  lookupTranslatedRationale,
  rationaleSourceFingerprint,
  shouldTranslateRationaleLocale,
  skipKoTranslationLlm,
} from '../rationale-display'

function model(overrides: Partial<CardModelPrediction> = {}): CardModelPrediction {
  return {
    prediction_id: 'pred-1',
    model_id: 'gpt-5.6-luna',
    brand: 'OpenAI',
    model_identifier: 'gpt-5.6-luna',
    camp: 'us',
    league_tier: 'world',
    direction: 'up',
    probability: 60,
    magnitude: 1,
    qualifierText: null,
    reasoning_snippet: 'Silver looks bid.',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-09-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('rationale display / stream trigger helpers', () => {
  it('skips en and pt; translates every other league locale', () => {
    expect(shouldTranslateRationaleLocale('en')).toBe(false)
    expect(shouldTranslateRationaleLocale('pt')).toBe(false)
    expect(shouldTranslateRationaleLocale('ko')).toBe(true)
    expect(shouldTranslateRationaleLocale('ja')).toBe(true)
    expect(shouldTranslateRationaleLocale('zh-TW')).toBe(true)
    expect(shouldTranslateRationaleLocale('fr')).toBe(true)
    expect(shouldTranslateRationaleLocale('es')).toBe(true)
    expect(shouldTranslateRationaleLocale('ar')).toBe(true)
  })

  it('fingerprint changes when a new tile with a snippet appears (stream/poll)', () => {
    const first = rationaleSourceFingerprint([model()])
    const second = rationaleSourceFingerprint([
      model(),
      model({ prediction_id: 'pred-2', model_id: 'claude-haiku-4.5', reasoning_snippet: 'Gold is heavy.' }),
    ])
    expect(first).not.toBe(second)
    expect(rationaleSourceFingerprint([])).toBe('')
    expect(rationaleSourceFingerprint([model({ reasoning_snippet: null })])).toBe('')
  })

  it('looks up by prediction_id, then model_id (live stream has null prediction_id)', () => {
    const map = { 'pred-1': '은이 매수세다.', 'claude-haiku-4.5': '금이 무겁다.' }
    expect(lookupTranslatedRationale(model(), map)).toBe('은이 매수세다.')
    expect(
      lookupTranslatedRationale(model({ prediction_id: null, model_id: 'claude-haiku-4.5' }), map)
    ).toBe('금이 무겁다.')
    expect(lookupTranslatedRationale(model({ prediction_id: 'missing', model_id: 'nope' }), map)).toBeNull()
  })

  it('pending only while in-flight, locale needs translation, and this tile has no translation yet', () => {
    expect(
      isRationaleTranslationPending({
        locale: 'ko',
        original: 'Silver looks bid.',
        translated: null,
        inFlight: true,
      })
    ).toBe(true)
    expect(
      isRationaleTranslationPending({
        locale: 'ko',
        original: 'Silver looks bid.',
        translated: '은이 매수세다.',
        inFlight: true,
      })
    ).toBe(false)
    expect(
      isRationaleTranslationPending({
        locale: 'ko',
        original: 'Silver looks bid.',
        translated: null,
        inFlight: false,
      })
    ).toBe(false)
    expect(
      isRationaleTranslationPending({
        locale: 'en',
        original: 'Silver looks bid.',
        translated: null,
        inFlight: true,
      })
    ).toBe(false)
  })

  it('skips the ko LLM when the snippet already has Hangul; still translates Hangul for ja/fr', () => {
    const korean =
      '본괘인 고는 갈등과 혼란의 상황을 나타내지만, 변괘 환은 변화와 해소를 의미합니다.'
    expect(isNativeKoreanText(korean)).toBe(true)
    expect(isNativeKoreanText('Last close ~4378 (FXEmpire 19Sep).')).toBe(false)
    expect(skipKoTranslationLlm('ko', korean)).toBe(true)
    expect(skipKoTranslationLlm('ja', korean)).toBe(false)
    expect(skipKoTranslationLlm('zh-TW', korean)).toBe(false)
    expect(skipKoTranslationLlm('fr', korean)).toBe(false)
    expect(skipKoTranslationLlm('ko', 'Gold trades near $4,378 with weekly gains.')).toBe(false)
  })
})
