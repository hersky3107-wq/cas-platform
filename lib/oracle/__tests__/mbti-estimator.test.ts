import { describe, expect, it } from 'vitest'
import {
  MBTI_ESTIMATOR_QUESTIONS,
  estimateMbti,
  type MbtiEstimatorAnswers,
  type MbtiPole,
} from '../mbti-estimator'

function fill(poles: MbtiPole[]): MbtiEstimatorAnswers {
  const answers: MbtiEstimatorAnswers = {}
  MBTI_ESTIMATOR_QUESTIONS.forEach((question, index) => {
    answers[question.id] = poles[index]!
  })
  return answers
}

describe('estimateMbti', () => {
  it('scores a clear ESTJ', () => {
    expect(estimateMbti(fill(['E', 'E', 'S', 'S', 'T', 'T', 'J', 'J']))).toBe('ESTJ')
  })

  it('scores a clear INFP', () => {
    expect(estimateMbti(fill(['I', 'I', 'N', 'N', 'F', 'F', 'P', 'P']))).toBe('INFP')
  })

  it('breaks ties toward I N F P', () => {
    expect(estimateMbti(fill(['E', 'I', 'S', 'N', 'T', 'F', 'J', 'P']))).toBe('INFP')
  })
})
