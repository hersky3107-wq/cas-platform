import { describe, expect, it } from 'vitest'
import { isEmptyModelText, parseLayer1Json } from '../parse-layer1'

const VALID = {
  narrative: '세 축이 동시에 밀린다. 추진은 일에 실리고 불의 비중과 전진 국면이 겹친다.',
  one_line: '일은 밀되 과신은 접어라',
  direction: 'advance',
  focus: 'work',
  axis_emphasis: ['drive', 'fire', 'advance'],
}

function validJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...VALID, ...overrides })
}

describe('parseLayer1Json', () => {
  it('accepts clean JSON', () => {
    const parsed = parseLayer1Json(validJson())
    expect(parsed).toEqual(VALID)
  })

  it('accepts fenced JSON', () => {
    const parsed = parseLayer1Json('```json\n' + validJson() + '\n```')
    expect(parsed).toEqual(VALID)
  })

  it('accepts JSON after a preamble', () => {
    const parsed = parseLayer1Json('Sure, here is the reading:\n' + validJson() + '\nHope that helps.')
    expect(parsed).toEqual(VALID)
  })

  it('returns null on garbage so the caller can 결번', () => {
    expect(parseLayer1Json('not json at all')).toBeNull()
    expect(parseLayer1Json('{"narrative":"only"}')).toBeNull()
    expect(parseLayer1Json('')).toBeNull()
  })

  it('truncates one_line to 40 characters', () => {
    const parsed = parseLayer1Json(validJson({ one_line: 'x'.repeat(80) }))
    expect(parsed?.one_line).toHaveLength(40)
  })

  it('rejects narrative over the 500-character hard ceiling', () => {
    expect(parseLayer1Json(validJson({ narrative: '가'.repeat(501) }))).toBeNull()
    expect(parseLayer1Json(validJson({ narrative: '가'.repeat(500) }))).not.toBeNull()
  })

  it('rejects an invalid direction or focus', () => {
    expect(parseLayer1Json(validJson({ direction: 'maybe' }))).toBeNull()
    expect(parseLayer1Json(validJson({ focus: 'career' }))).toBeNull()
  })
})

describe('isEmptyModelText', () => {
  it('is trim-aware', () => {
    expect(isEmptyModelText(null)).toBe(true)
    expect(isEmptyModelText('')).toBe(true)
    expect(isEmptyModelText('   \n')).toBe(true)
    expect(isEmptyModelText('  ok  ')).toBe(false)
  })
})
