import { describe, expect, it } from 'vitest'
import {
  classifyBallotAxis,
  classifyOracleQuestion,
  extractChoiceOptions,
  formatOppositionVoteLine,
  matchChoiceOption,
} from '../question-axis'

describe('classifyOracleQuestion', () => {
  it('treats an empty question as none and keeps the action axis', () => {
    expect(classifyOracleQuestion(null)).toMatchObject({
      kind: 'none',
      confidence: 'certain',
    })
    expect(classifyOracleQuestion('   ')).toMatchObject({ kind: 'none' })
  })

  it('classifies the session 9bbef47c question as prediction / timing', () => {
    const axis = classifyOracleQuestion(
      '엄마가 나한테 진정한 물질적 또는 인맥사회적인 도움을 몇년안에 줄 것인가?',
    )
    expect(axis).toMatchObject({ kind: 'prediction', confidence: 'certain' })
    expect(axis.reason).toMatch(/prediction|timing|될까|언제/i)
  })

  it('classifies 어떻게 / 방향 as action', () => {
    expect(classifyOracleQuestion('올해 일의 방향을 어떻게 잡아야 하는가')).toMatchObject({
      kind: 'action',
      confidence: 'certain',
    })
    expect(classifyOracleQuestion('이직을 어떻게 할까')).toMatchObject({
      kind: 'action',
      confidence: 'certain',
    })
  })

  it('lets 어떻게 win when both action and prediction markers appear', () => {
    expect(classifyOracleQuestion('이 일이 어떻게 될까')).toMatchObject({
      kind: 'action',
      confidence: 'certain',
    })
  })

  it('classifies 될까 / 언제 without 어떻게 as prediction', () => {
    expect(classifyOracleQuestion('이직해도 될까?')).toMatchObject({
      kind: 'prediction',
      confidence: 'certain',
    })
    expect(classifyOracleQuestion('언제 이직하는 게 맞을까')).toMatchObject({
      kind: 'prediction',
      confidence: 'certain',
    })
  })

  it('extracts named options and classifies A냐 B냐 / 할까 pairs as choice', () => {
    expect(extractChoiceOptions('이직할까 남을까')).toEqual(['이직', '남'])
    expect(classifyOracleQuestion('이직할까 남을까')).toMatchObject({
      kind: 'choice',
      options: ['이직', '남'],
      confidence: 'certain',
    })
    expect(classifyOracleQuestion('서울이냐 부산이냐 제주냐').options).toEqual(['서울', '부산', '제주'])
    expect(classifyOracleQuestion('A vs B')).toMatchObject({
      kind: 'choice',
      options: ['A', 'B'],
    })
  })

  it('does not treat a single 할까 as a choice', () => {
    expect(extractChoiceOptions('엄마가 몇 년 안에 도와줄까')).toBeNull()
    expect(extractChoiceOptions('어떻게 할까')).toBeNull()
  })

  it('defaults uncertain wording to the action axis without relabelling it as prediction', () => {
    const axis = classifyOracleQuestion('올해 직장운')
    expect(axis).toEqual({
      kind: 'action',
      options: [],
      confidence: 'defaulted',
      reason: 'uncertain — default to the action axis',
    })
  })

  it('compat stays on the relationship-motion axis even for 언제 questions', () => {
    expect(classifyBallotAxis('compat', '언제 결혼할까')).toMatchObject({
      kind: 'action',
      confidence: 'certain',
      reason: 'compat uses the relationship-motion axis',
    })
  })
})

describe('matchChoiceOption / opposition format', () => {
  it('matches listed options case-insensitively', () => {
    expect(matchChoiceOption('이직', ['이직', '남'])).toBe('이직')
    expect(matchChoiceOption('남기', ['이직', '남'])).toBe('남')
    expect(matchChoiceOption('C', ['A', 'B'])).toBeNull()
  })

  it('formats opposition from projector votes, never quoted one_lines', () => {
    expect(formatOppositionVoteLine('PRISM', 'advance', '숙요', 'release')).toBe(
      'PRISM는 나아가라고 하고, 숙요는 정리하라고 합니다.',
    )
  })
})
