import { describe, expect, it } from 'vitest'
import {
  OPERATOR_NAME_MATCH_FORM_KO,
  OPERATOR_OCCURRENCE_FORM_KO,
} from '../operator-form-copy'

describe('operator occurrence form — a world fact, not a model verdict', () => {
  it('radios are occurred / did not occur in Korean, tied to the proposition', () => {
    expect(OPERATOR_OCCURRENCE_FORM_KO.occurred).toBe('명제한 일이 발생했다')
    expect(OPERATOR_OCCURRENCE_FORM_KO.didNotOccur).toBe('명제한 일이 발생하지 않았다')
    expect(OPERATOR_OCCURRENCE_FORM_KO.intro).toContain('세상에 일어났는지')
    expect(OPERATOR_OCCURRENCE_FORM_KO.intro).toContain('모델이 맞았는지 틀렸는지는 고르지 않습니다')
  })

  it('choice labels are not side tokens and not correct/incorrect', () => {
    const choices = `${OPERATOR_OCCURRENCE_FORM_KO.occurred} ${OPERATOR_OCCURRENCE_FORM_KO.didNotOccur}`
    expect(choices).not.toMatch(/yes|no|correct|incorrect|정답|오답|실현|불발|winner/i)
    expect(OPERATOR_OCCURRENCE_FORM_KO.factHint).toMatch(/정답\/오답은 적지 마세요/)
  })

  it('name-match copy still forbids picking a winner', () => {
    expect(OPERATOR_NAME_MATCH_FORM_KO.intro).toContain('승자를 고르지 마세요')
  })
})
