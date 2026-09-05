import { describe, expect, it } from 'vitest'
import { parseVerdictJson, verdictDirectionMismatch } from '../parse-verdict'

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

/**
 * FIX 4 — the fb3336ed disease: "만장일치 · 전진 3표" over three verdicts that
 * all said stop expanding and finish what exists.
 */
describe('verdictDirectionMismatch', () => {
  it('flags an advance vote whose text says consolidate/finish (the fb3336ed case)', () => {
    const check = verdictDirectionMismatch({
      verdict_line: '벌린 일을 늘리지 말고 지금 있는 것을 마무리하며 기반을 다지는 때다.',
      direction: 'advance',
    })
    expect(check.mismatch).toBe(true)
    expect(check.textDirection).toBe('hold')
  })

  it('accepts a ballot whose text matches its vote', () => {
    expect(
      verdictDirectionMismatch({
        verdict_line: '이번 주는 새 제안에 착수하고 넓히는 쪽이 맞다.',
        direction: 'advance',
      }).mismatch,
    ).toBe(false)
    expect(
      verdictDirectionMismatch({
        verdict_line: '끝난 관계는 정리하고 내려놓아야 새 흐름이 들어온다.',
        direction: 'release',
      }).mismatch,
    ).toBe(false)
  })

  it('does not flag negated framings that name both sides', () => {
    // "무리한 확장보다 유지" mentions 확장 AND 유지 — the voted side is present,
    // so the conservative rule stays silent.
    expect(
      verdictDirectionMismatch({
        verdict_line: '무리한 확장보다 지금 판을 유지하는 편이 낫다.',
        direction: 'hold',
      }).mismatch,
    ).toBe(false)
  })

  it('stays silent when the text carries no direction keyword at all', () => {
    expect(
      verdictDirectionMismatch({
        verdict_line: '재물 축이 유난히 밝고 관계 축은 흐리다.',
        direction: 'advance',
      }).mismatch,
    ).toBe(false)
  })
})
