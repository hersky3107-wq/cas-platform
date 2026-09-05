import { describe, expect, it } from 'vitest'
import {
  isEmptyModelText,
  LAYER1_NARRATIVE_MAX,
  LAYER1_NARRATIVE_MIN,
  LAYER1_ONE_LINE_MAX,
  parseLayer1Json,
} from '../parse-layer1'

// v4 band (FIX 3): narratives must land inside 400..1100 code points.
const NARRATIVE =
  '세 축이 동시에 밀린다. 추진은 일에 실리고 불의 비중과 전진 국면이 겹친다. '.repeat(12)

const VALID = {
  narrative: NARRATIVE.trim(),
  one_line: '일은 밀되 과신은 접어라',
  direction: 'advance',
  focus: 'work',
  axis_emphasis: ['drive', 'fire', 'advance'],
}

function validJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...VALID, ...overrides })
}

describe('parseLayer1Json', () => {
  it('fixture narrative sits inside the v4 band', () => {
    const length = [...VALID.narrative].length
    expect(length).toBeGreaterThanOrEqual(LAYER1_NARRATIVE_MIN)
    expect(length).toBeLessThanOrEqual(LAYER1_NARRATIVE_MAX)
  })

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

  it(`truncates one_line to ${LAYER1_ONE_LINE_MAX} characters`, () => {
    const parsed = parseLayer1Json(validJson({ one_line: 'x'.repeat(LAYER1_ONE_LINE_MAX * 2) }))
    expect(parsed?.one_line).toHaveLength(LAYER1_ONE_LINE_MAX)
  })

  it(`rejects narrative over the ${LAYER1_NARRATIVE_MAX}-character hard ceiling`, () => {
    expect(parseLayer1Json(validJson({ narrative: '가'.repeat(LAYER1_NARRATIVE_MAX + 1) }))).toBeNull()
    expect(parseLayer1Json(validJson({ narrative: '가'.repeat(LAYER1_NARRATIVE_MAX) }))).not.toBeNull()
  })

  it(`rejects narrative under the ${LAYER1_NARRATIVE_MIN}-character floor (FIX 3: no thin premium readings)`, () => {
    expect(parseLayer1Json(validJson({ narrative: '가'.repeat(LAYER1_NARRATIVE_MIN - 1) }))).toBeNull()
    expect(parseLayer1Json(validJson({ narrative: '가'.repeat(LAYER1_NARRATIVE_MIN) }))).not.toBeNull()
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
