import { describe, expect, it } from 'vitest'
import { parseVerdictJson } from '../parse-verdict'

const BALLOT = {
  verdict_line: '사주와 타로가 같은 문을 가리킨다. 이번 주는 미는 쪽이 맞다.',
  direction: 'advance',
  focus: 'work',
  domains: { work: 72, money: 55, love: 48, social: 60, energy: 65 },
  minority_opinion: null,
}

describe('parseVerdictJson', () => {
  it('parses a valid ballot', () => {
    const parsed = parseVerdictJson(JSON.stringify(BALLOT), 3)
    expect(parsed).not.toBeNull()
    expect(parsed!.direction).toBe('advance')
    expect(parsed!.focus).toBe('work')
    expect(parsed!.domains.energy).toBe(65)
    expect(parsed!.minority_opinion).toBeNull()
  })

  it('parses fenced JSON and rounds fractional domain scores', () => {
    const fenced = '```json\n' + JSON.stringify({ ...BALLOT, domains: { ...BALLOT.domains, work: 71.6 } }) + '\n```'
    const parsed = parseVerdictJson(fenced, 3)
    expect(parsed!.domains.work).toBe(72)
  })

  it('enforces the per-count verdict_line budget (same line: ok at 3, reject at 9)', () => {
    const line = '가'.repeat(121)
    const ballot = JSON.stringify({ ...BALLOT, verdict_line: line })
    expect(parseVerdictJson(ballot, 3)).not.toBeNull()
    expect(parseVerdictJson(ballot, 7)).toBeNull()
    expect(parseVerdictJson(ballot, 9)).toBeNull()
  })

  it('rejects unknown direction or focus enums', () => {
    expect(parseVerdictJson(JSON.stringify({ ...BALLOT, direction: 'retreat' }), 3)).toBeNull()
    expect(parseVerdictJson(JSON.stringify({ ...BALLOT, focus: 'career' }), 3)).toBeNull()
  })

  it('rejects missing or out-of-range domains', () => {
    const partial: Partial<typeof BALLOT.domains> = { ...BALLOT.domains }
    delete partial.energy
    expect(parseVerdictJson(JSON.stringify({ ...BALLOT, domains: partial }), 3)).toBeNull()
    expect(
      parseVerdictJson(JSON.stringify({ ...BALLOT, domains: { ...BALLOT.domains, money: 140 } }), 3),
    ).toBeNull()
    expect(
      parseVerdictJson(JSON.stringify({ ...BALLOT, domains: { ...BALLOT.domains, money: -5 } }), 3),
    ).toBeNull()
    expect(
      parseVerdictJson(JSON.stringify({ ...BALLOT, domains: { ...BALLOT.domains, money: 'high' } }), 3),
    ).toBeNull()
  })

  it('normalizes empty minority_opinion to null and rejects over-limit dissent', () => {
    expect(
      parseVerdictJson(JSON.stringify({ ...BALLOT, minority_opinion: '  ' }), 3)!.minority_opinion,
    ).toBeNull()
    expect(
      parseVerdictJson(JSON.stringify({ ...BALLOT, minority_opinion: '나'.repeat(200) }), 3),
    ).toBeNull()
    expect(
      parseVerdictJson(JSON.stringify({ ...BALLOT, minority_opinion: '다수는 전진이지만 재물 축이 비어 있다.' }), 3)!
        .minority_opinion,
    ).toContain('재물 축')
  })

  it('rejects non-JSON and missing verdict_line', () => {
    expect(parseVerdictJson('<<< not json >>>', 3)).toBeNull()
    const rest: Partial<typeof BALLOT> = { ...BALLOT }
    delete rest.verdict_line
    expect(parseVerdictJson(JSON.stringify(rest), 3)).toBeNull()
  })
})
