import { describe, expect, it } from 'vitest'
import { MBTI_ESTIMATOR_QUESTIONS } from '../../mbti-estimator'
import { SURVEY_QUESTIONS } from '../../survey-data'
import {
  ORACLE_PROFILE_I18N_NAMESPACE,
  ORACLE_PROFILE_MBTI_IDS,
  ORACLE_UI_LOCALES,
  countOracleProfileCopyStrings,
  getOracleProfileCopy,
  oracleProfileCopy,
} from '../index'

describe('oracle.profile i18n', () => {
  it('exposes the oracle.profile namespace and eight locale slots', () => {
    expect(ORACLE_PROFILE_I18N_NAMESPACE).toBe('oracle.profile')
    expect(ORACLE_UI_LOCALES).toEqual(['en', 'ko', 'ja', 'zh-TW', 'fr', 'ar', 'es', 'pt'])
    for (const locale of ORACLE_UI_LOCALES) {
      expect(oracleProfileCopy[locale]).toBe(getOracleProfileCopy('ko'))
    }
  })

  it('keeps 시진 survey choice counts aligned with the engine questionnaire', () => {
    const copy = getOracleProfileCopy('ko')
    for (const question of SURVEY_QUESTIONS) {
      expect(copy.survey[question.id].choices).toHaveLength(question.choices.length)
    }
  })

  it('keeps MBTI estimator ids aligned with the scoring table', () => {
    expect(MBTI_ESTIMATOR_QUESTIONS.map((question) => question.id)).toEqual([...ORACLE_PROFILE_MBTI_IDS])
  })

  it('extracts a stable leaf-string count so a later locale pass cannot drop keys silently', () => {
    expect(countOracleProfileCopyStrings(getOracleProfileCopy('ko'))).toBe(175)
  })
})
