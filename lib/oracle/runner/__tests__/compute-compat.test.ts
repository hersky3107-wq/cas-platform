/**
 * 궁합 computation stage — the kind='compat' sibling of compute.test.ts.
 *
 * The privacy sections mirror privacy.test.ts with the SAME strictness for
 * Person B: her birth date, time, and name are session-scoped needles, and no
 * pair payload may carry either person's identity. Person B deliberately has
 * a single-character-surname Korean name so the needle splitter is exercised.
 */
import { describe, expect, it } from 'vitest'
import { COMPAT_RUNE_LABELS, COMPAT_TAROT_LABELS } from '../../engines/draw/conventions'
import { OracleComputeError, personalDataFrom } from '../compute'
import { COMPAT_SINGLE_SYSTEMS, isCompatSingleSystem, runCompatComputations } from '../compute-compat'
import { isFreeOfPersonalData } from '../privacy'
import type { OracleCompatPartnerInput } from '../session-inputs'
import { makeProfile } from './fakes'

const AS_OF = '2026-09-07'
const PROFILE = makeProfile()

const PARTNER: OracleCompatPartnerInput = {
  birthDate: '1991-03-08',
  birthTime: '21:40',
  sex: 'M',
  name: '박도윤',
}

const ALL_SYSTEMS = [
  'saju',
  'astro',
  'prism',
  'ziwei',
  'numerology',
  'name',
  'iching',
  'tarot',
  'runes',
  'ninestar',
  'sukuyou',
  'tzolkin',
] as const

/** Both people's literals — none may appear in any pair payload. */
const FORBIDDEN_LITERALS = [
  PROFILE.birth_date,
  '04:17',
  PROFILE.birth_place!,
  PROFILE.name_local!,
  'Minseo',
  'Kim',
  PARTNER.birthDate,
  '21:40',
  PARTNER.name!,
  '도윤', // given name alone must also be a needle
]

function computeAll(partner: OracleCompatPartnerInput = PARTNER) {
  return runCompatComputations({
    profile: PROFILE,
    partner,
    systems: [...ALL_SYSTEMS],
    seed: 'seed-compat',
    asOfDate: AS_OF,
    locale: 'ko',
    question: null,
    sessionInputs: {
      partner,
      tarot: { spread: 5, pickedPositions: [14, 3, 71, 8, 22] },
      runes: { spread: 3, pickedPositions: [5, 12, 24] },
      iching: { lines: [7, 8, 9, 6, 7, 8] },
    },
    personalData: personalDataFrom([PROFILE], partner),
  })
}

describe('runCompatComputations', () => {
  it('produces a payload for all 12 systems when both sides are complete', () => {
    const computed = computeAll()
    const withPayload = computed.systems.filter((entry) => entry.aiPayload !== null)
    expect(withPayload.map((entry) => entry.system).sort()).toEqual([...ALL_SYSTEMS].sort())
  })

  it('tzolkin reads both portraits but casts NO vote (no invented pair rule)', () => {
    const computed = computeAll()
    const tzolkin = computed.systems.find((entry) => entry.system === 'tzolkin')!
    expect(tzolkin.aiPayload).not.toBeNull()
    expect(tzolkin.vote).not.toBeNull()
    expect(tzolkin.vote!.traits).toBeNull()
    expect(tzolkin.vote!.elements).toBeNull()
    expect(tzolkin.vote!.phase).toBeNull()
    expect(tzolkin.vote!.unreadable.map((item) => item.code)).toEqual([
      'tzolkin.no_pair_rule',
      'tzolkin.no_pair_rule',
      'tzolkin.no_pair_rule',
    ])
    const chart = tzolkin.aiPayload!.chart as { 안내?: string }
    expect(chart.안내).toContain('궁합 규칙이 전해지지 않습니다')
  })

  it('tzolkin is not offered as 단일 궁합; the other eleven are', () => {
    expect(isCompatSingleSystem('tzolkin')).toBe(false)
    expect(COMPAT_SINGLE_SYSTEMS).toHaveLength(11)
    for (const system of COMPAT_SINGLE_SYSTEMS) {
      expect(isCompatSingleSystem(system)).toBe(true)
    }
  })

  it('blended pair votes never outweigh a native vote: weight 0.5, basis derived', () => {
    const computed = computeAll()
    for (const system of ['saju', 'astro', 'numerology', 'ninestar', 'sukuyou'] as const) {
      const vote = computed.systems.find((entry) => entry.system === system)!.vote!
      expect(vote.traits, system).not.toBeNull()
      expect(vote.confidence.traits?.weight, system).toBe(0.5)
      expect(vote.confidence.traits?.basis, system).toBe('derived')
    }
  })

  it('every pair result carries a typed relation block (the native two-person material)', () => {
    const computed = computeAll()
    for (const system of ['saju', 'astro', 'ziwei', 'numerology', 'name', 'ninestar', 'sukuyou'] as const) {
      const result = computed.systems.find((entry) => entry.system === system)!.result!
      expect(result.pair, system).toBe(true)
      expect(result.relation, system).toBeTypeOf('object')
    }
  })

  it('saju relation carries 일간 천간합/오행 and 일지·띠 합충 from the canonical tables', () => {
    const relation = computeAll().systems.find((entry) => entry.system === 'saju')!.result!
      .relation as {
      dayStem: { combination: unknown; elements: string }
      dayBranch: { relation: Record<string, unknown> }
      yearBranch: { relation: Record<string, unknown> }
    }
    expect(['same', 'a_generates_b', 'b_generates_a', 'a_overcomes_b', 'b_overcomes_a']).toContain(
      relation.dayStem.elements,
    )
    for (const key of ['yukhap', 'samhap', 'chung', 'wonjin']) {
      expect(relation.dayBranch.relation, `day.${key}`).toHaveProperty(key)
      expect(relation.yearBranch.relation, `year.${key}`).toHaveProperty(key)
    }
  })

  it('sukuyou relation is the 三九の秘法 in both directions', () => {
    const relation = computeAll().systems.find((entry) => entry.system === 'sukuyou')!.result!
      .relation as { fromA: { pair: string }; fromB: { pair: string } }
    const pairs = ['命', '業胎', '栄親', '友衰', '安壊', '危成']
    expect(pairs).toContain(relation.fromA.pair)
    expect(pairs).toContain(relation.fromB.pair)
  })

  it('prism uses its native pair sketch and needs no MBTI and no colours', () => {
    const computed = runCompatComputations({
      profile: makeProfile({ mbti: null }),
      partner: PARTNER,
      systems: ['prism'],
      seed: 'seed-compat-prism',
      asOfDate: AS_OF,
      locale: 'ko',
      question: null,
      sessionInputs: { partner: PARTNER }, // no prism colours on purpose
      personalData: personalDataFrom([makeProfile({ mbti: null })], PARTNER),
    })
    const prism = computed.systems[0]!
    expect(prism.aiPayload).not.toBeNull()
    expect(prism.vote).not.toBeNull()
    const sketch = prism.result!.sketch as { anchorConcordance: number }
    expect(sketch.anchorConcordance).toBeGreaterThanOrEqual(0)
    expect(sketch.anchorConcordance).toBeLessThanOrEqual(100)
  })

  it('draw systems read THE RELATIONSHIP: one draw, relationship position labels', () => {
    const computed = computeAll()
    const tarot = computed.systems.find((entry) => entry.system === 'tarot')!
    const draw = tarot.result!.draw as { cards: Array<{ positionLabel: string }> }
    expect(draw.cards.map((card) => card.positionLabel)).toEqual([...COMPAT_TAROT_LABELS[5]!])

    const runes = computed.systems.find((entry) => entry.system === 'runes')!
    const runeDraw = runes.result!.draw as { runes: Array<{ positionLabel: string }> }
    expect(runeDraw.runes.map((rune) => rune.positionLabel)).toEqual([...COMPAT_RUNE_LABELS[3]!])

    const iching = computed.systems.find((entry) => entry.system === 'iching')!
    const chart = iching.aiPayload!.chart as { 세응풀이?: string }
    expect(chart.세응풀이).toContain('세효')
    expect(chart.세응풀이).toContain('응효')
  })

  it('degrades honestly per side: no partner birth time drops HER ziwei, not the session', () => {
    const partner: OracleCompatPartnerInput = { ...PARTNER, birthTime: null }
    const computed = runCompatComputations({
      profile: PROFILE,
      partner,
      systems: ['ziwei', 'saju'],
      seed: 'seed-compat-degrade',
      asOfDate: AS_OF,
      locale: 'ko',
      question: null,
      sessionInputs: { partner },
      personalData: personalDataFrom([PROFILE], partner),
    })
    const ziwei = computed.systems.find((entry) => entry.system === 'ziwei')!
    expect(ziwei.aiPayload).toBeNull()
    expect(ziwei.unreadableCode).toBe('compat.ziwei.partner_no_birth_time')
    // saju still reads — the 시주 is simply absent on B's side.
    expect(computed.systems.find((entry) => entry.system === 'saju')!.aiPayload).not.toBeNull()
    expect(computed.assumptions.partnerBirthTimeUnknown).toBe(true)
  })

  it('name 궁합 without Person B name is a 결번 beside other systems, and a hard fail alone', () => {
    const partner: OracleCompatPartnerInput = { ...PARTNER, name: null }
    const base = {
      profile: PROFILE,
      partner,
      seed: 'seed-compat-noname',
      asOfDate: AS_OF,
      locale: 'ko',
      question: null,
      sessionInputs: { partner },
      personalData: personalDataFrom([PROFILE], partner),
    } as const

    // Beside another readable system the name reading is an honest 결번.
    const computed = runCompatComputations({ ...base, systems: ['name', 'saju'] })
    const name = computed.systems.find((entry) => entry.system === 'name')!
    expect(name.aiPayload).toBeNull()
    expect(name.unreadableCode).toBe('compat.name.partner_name_missing')
    expect(computed.systems.find((entry) => entry.system === 'saju')!.aiPayload).not.toBeNull()

    // Alone it must fail the whole computation — never charge for an empty session.
    expect(() => runCompatComputations({ ...base, systems: ['name'] })).toThrow(OracleComputeError)
  })

  it('records the partner assumption flags for the UI', () => {
    const partner: OracleCompatPartnerInput = { birthDate: '1991-03-08', birthTime: null, sex: null, name: null }
    const computed = runCompatComputations({
      profile: PROFILE,
      partner,
      systems: ['saju'],
      seed: 'seed-compat-flags',
      asOfDate: AS_OF,
      locale: 'ko',
      question: null,
      sessionInputs: { partner },
      personalData: personalDataFrom([PROFILE], partner),
    })
    expect(computed.assumptions.partnerBirthTimeUnknown).toBe(true)
    expect(computed.assumptions.partnerSexDefaulted).toBe(true)
    expect(computed.assumptions.partnerLocationAssumed).toBe(true)
  })
})

describe('궁합 privacy — Person B is scanned with the SAME strictness', () => {
  it('the needle set covers the partner: date, time, full name, and split name parts', () => {
    const pii = personalDataFrom([PROFILE], PARTNER)
    expect(pii.others).toBeDefined()
    const partnerNeedles = pii.others!.at(-1)!
    expect(partnerNeedles.birthDate).toBe(PARTNER.birthDate)
    expect(partnerNeedles.birthTime).toBe('21:40')
    expect(partnerNeedles.names).toContain('박도윤')
    expect(partnerNeedles.names).toContain('박')
    expect(partnerNeedles.names).toContain('도윤')
  })

  it('no pair payload carries either person\'s birth data or name', () => {
    const computed = computeAll()
    const pii = personalDataFrom([PROFILE], PARTNER)
    const withPayload = computed.systems.filter((entry) => entry.aiPayload !== null)
    expect(withPayload).toHaveLength(12)

    for (const entry of withPayload) {
      const serialized = JSON.stringify(entry.aiPayload).toLowerCase()
      for (const literal of FORBIDDEN_LITERALS) {
        const needle = literal.toLowerCase()
        const leaked = /^[a-z]+$/.test(needle)
          ? new RegExp(`\\b${needle}\\b`).test(serialized)
          : serialized.includes(needle)
        expect(leaked, `${entry.system} leaked "${literal}"`).toBe(false)
      }
      expect(
        isFreeOfPersonalData(entry.aiPayload, pii, { machineCodeFields: [] }),
        `${entry.system} failed the runtime gate`,
      ).toBe(true)
    }
  })

  it('a payload that mentions Person B\'s birth date would fail the gate (fail-closed)', () => {
    const pii = personalDataFrom([PROFILE], PARTNER)
    expect(isFreeOfPersonalData({ note: `two people, one born ${PARTNER.birthDate}` }, pii)).toBe(false)
    expect(isFreeOfPersonalData({ note: `상대는 ${PARTNER.name} 님입니다` }, pii)).toBe(false)
    expect(isFreeOfPersonalData({ note: '태어난 시각 21:40' }, pii)).toBe(false)
  })

  it("'본인'/'상대' role labels never collide with a single-char Korean surname needle", () => {
    // Person B's surname 박 is a needle. The pair charts use 본인/상대 as role
    // words — if a chart said '박' anywhere as a standalone value it would (and
    // should) fail. This asserts the charts pass WITH such a needle active.
    const pii = personalDataFrom([PROFILE], PARTNER)
    const computed = computeAll()
    for (const entry of computed.systems) {
      if (entry.aiPayload === null) continue
      expect(isFreeOfPersonalData(entry.aiPayload, pii, { machineCodeFields: [] })).toBe(true)
    }
  })

  it('layer-1 pair payloads are native: no axis scores, no projector code fields', () => {
    const computed = computeAll()
    for (const entry of computed.systems) {
      if (entry.aiPayload === null) continue
      expect(entry.aiPayload.readingInput, entry.system).toBe('native')
      expect(entry.aiPayload.traits, entry.system).toBeUndefined()
      expect(entry.aiPayload.elements, entry.system).toBeUndefined()
      expect(entry.aiPayload.phase, entry.system).toBeUndefined()
      expect(entry.aiPayload.reasons, entry.system).toBeUndefined()
      expect(entry.aiPayload.kind, entry.system).toBe('compat')
    }
  })

  it('personalDataFrom covers EVERY loaded profile, not only the first', () => {
    const second = makeProfile({
      id: 'profile-partner-row',
      birth_date: '1979-01-31',
      name_local: '이서준',
      birth_place: 'Daegu',
    })
    const pii = personalDataFrom([PROFILE, second])
    expect(pii.others).toHaveLength(1)
    expect(pii.others![0]!.birthDate).toBe('1979-01-31')
    expect(isFreeOfPersonalData({ note: 'born 1979-01-31' }, pii)).toBe(false)
    expect(isFreeOfPersonalData({ note: '이서준의 운세' }, pii)).toBe(false)
    expect(isFreeOfPersonalData({ note: 'city Daegu' }, pii)).toBe(false)
  })
})
