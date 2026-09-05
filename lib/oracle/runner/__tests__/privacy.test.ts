/**
 * The privacy rule: ai_payload carries computed values only.
 *
 * This is the test the spec asks for by name. It runs the real 12-system
 * calculation on a profile whose every identifying field is distinctive, then
 * scans each ai_payload two ways: through the runtime gate, and with a raw
 * string scan of the serialized JSON so a leak cannot hide behind a nested
 * key the gate's walker might not reach.
 */
import { describe, expect, it } from 'vitest'
import { computeConsensus } from '../../axes'
import { PRISM_COLORS } from '../../engines/prism'
import { personalDataFrom, runComputations } from '../compute'
import {
  buildSynthesisPayload,
  buildVerdictPayload,
  MACHINE_CODE_FIELDS,
  SYNTHESIS_NARRATIVE_MAX_TOKENS,
  truncateNarrativeForSynthesis,
} from '../payload'
import {
  assertNoPersonalData,
  isFreeOfPersonalData,
  MACHINE_CODE_PATTERN,
  OraclePrivacyError,
} from '../privacy'
import { makeProfile } from './fakes'

const AS_OF = '2026-08-20'

const PROFILE = makeProfile()
const SESSION_INPUTS = {
  prism: {
    impulse: PRISM_COLORS[0],
    need: PRISM_COLORS[1],
    identity: PRISM_COLORS[2],
    microCheck: [3, 4, 2, 3] as const,
  },
}

/** Every literal that must never appear in a payload, however nested. */
const FORBIDDEN_LITERALS = [
  PROFILE.birth_date,
  PROFILE.birth_time!,
  '04:17',
  PROFILE.birth_place!,
  PROFILE.tz!,
  PROFILE.name_local!,
  PROFILE.name_latin!,
  'Minseo',
  'Kim',
  String(PROFILE.lat),
  String(PROFILE.lng),
]

function computeAll() {
  return runComputations({
    profile: PROFILE,
    systems: [
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
    ],
    seed: 'seed-privacy',
    asOfDate: AS_OF,
    locale: 'ko',
    kind: 'personal',
    question: null,
    sessionInputs: SESSION_INPUTS,
    personalData: personalDataFrom([PROFILE]),
  })
}

describe('ai_payload privacy rule', () => {
  it('carries no birth date, birth time, place, name, coordinates, or timezone', () => {
    const computed = computeAll()
    const pii = personalDataFrom([PROFILE])
    const withPayload = computed.systems.filter((entry) => entry.aiPayload !== null)

    expect(withPayload.length).toBeGreaterThanOrEqual(11)

    for (const entry of withPayload) {
      const payload = { ...entry.aiPayload! }
      // Machine-code fields are shape-checked separately below, because a
      // projector code can legitimately collide with a short romanized name.
      for (const field of MACHINE_CODE_FIELDS) delete payload[field]

      const serialized = JSON.stringify(payload).toLowerCase()
      for (const literal of FORBIDDEN_LITERALS) {
        const needle = literal.toLowerCase()
        // Same rule as privacy.ts: ASCII name tokens use word boundaries, so
        // the Maya nawal "Kimi" in tzolkin's native chart is not a leak of
        // surname "Kim".
        const leaked = /^[a-z]+$/.test(needle)
          ? new RegExp(`\\b${needle}\\b`).test(serialized)
          : serialized.includes(needle)
        expect(leaked, `${entry.system} leaked "${literal}"`).toBe(false)
      }
      expect(isFreeOfPersonalData(entry.aiPayload, pii, { machineCodeFields: MACHINE_CODE_FIELDS })).toBe(true)
    }
  })

  it('layer-1 payloads carry no projector machine-code fields at all (FIX 1: native only)', () => {
    const computed = computeAll()
    for (const entry of computed.systems) {
      if (entry.aiPayload === null) continue
      for (const field of MACHINE_CODE_FIELDS) {
        expect(entry.aiPayload[field], `${entry.system} carries ${field}`).toBeUndefined()
      }
    }
  })

  it('projector reason codes still match the machine-code pattern (verdict payload path)', () => {
    // Reason codes live on the AxisVote (server-side) — the pattern is still
    // enforced so nothing prose-like ever hides in a machine field.
    const computed = computeAll()
    for (const entry of computed.systems) {
      if (entry.vote === null) continue
      for (const space of ['traits', 'elements', 'phase'] as const) {
        for (const code of entry.vote.reasons[space] ?? []) {
          expect(code, `${entry.system} reason "${code}"`).toMatch(MACHINE_CODE_PATTERN)
        }
      }
      for (const item of entry.vote.unreadable) {
        expect(item.code).toMatch(MACHINE_CODE_PATTERN)
      }
    }
  })

  it('still stores the raw engine result server-side — only ai_payload is restricted', () => {
    const computed = computeAll()
    const saju = computed.systems.find((entry) => entry.system === 'saju')
    expect(saju?.result).not.toBeNull()
    expect(saju?.axes).not.toBeNull()
  })

  it('does not copy raw PRISM session inputs into ai_payload', () => {
    const prism = computeAll().systems.find((entry) => entry.system === 'prism')!
    expect(prism.aiPayload).not.toBeNull()

    const serialized = JSON.stringify(prism.aiPayload)
    expect(serialized).not.toContain('"impulse"')
    expect(serialized).not.toContain('"need"')
    expect(serialized).not.toContain('"identity"')
    expect(serialized).not.toContain('"microCheck"')
    expect(serialized).not.toContain(PRISM_COLORS[0])
    expect(serialized).not.toContain(PRISM_COLORS[1])
    expect(serialized).not.toContain(PRISM_COLORS[2])
  })

  it('the layer-2 verdict payload is held to the same rule', () => {
    const computed = computeAll()
    const pii = personalDataFrom([PROFILE])
    const payload = buildVerdictPayload(
      {
        readerSlug: 'archivist',
        readerIndex: 1,
        readerCount: 3,
        consensus: computed.consensus,
        readings: [],
      },
      { kind: 'personal', locale: 'ko', readingScope: 'life', asOfDate: AS_OF, question: null },
      pii,
    )

    const serialized = JSON.stringify(payload)
    for (const literal of FORBIDDEN_LITERALS) {
      expect(serialized).not.toContain(literal)
    }
  })

  it('synthesis gets only truncated narratives plus axis consensus — never raw engine payloads or model identity', () => {
    const computed = computeAll()
    const pii = personalDataFrom([PROFILE])
    const long = Array.from({ length: 260 }, (_, i) => `단어${i}`).join(' ')
    const payload = buildSynthesisPayload(
      [
        {
          id: 'reading-1',
          session_id: 'session-1',
          computation_id: 'computation-1',
          system: 'saju',
          brand: 'secret-brand',
          model: 'secret-model',
          narrative: long,
          summary: { internal: 'do not copy' },
          status: 'done',
          latency_ms: 1,
          tokens_in: 1,
          tokens_out: 1,
        },
      ],
      computed.consensus,
      pii,
    )
    expect(Object.keys(payload).sort()).toEqual(['consensus', 'readings'])
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('secret-brand')
    expect(serialized).not.toContain('secret-model')
    expect(serialized).not.toContain('do not copy')
    expect(serialized).not.toContain('"result"')
    expect(serialized).not.toContain('"ai_payload"')
    const narrative = (payload.readings as Array<{ narrative: string }>)[0]!.narrative
    expect(truncateNarrativeForSynthesis(long)).toBe(narrative)
    expect((narrative.match(/단어/g) ?? []).length).toBeLessThanOrEqual(SYNTHESIS_NARRATIVE_MAX_TOKENS)
  })

  it('rejects a forbidden key even when the value is harmless', () => {
    const pii = personalDataFrom([PROFILE])
    expect(() => assertNoPersonalData({ nested: { birth_date: 'redacted' } }, pii)).toThrow(OraclePrivacyError)
    expect(() => assertNoPersonalData({ nested: { tz: 'UTC' } }, pii)).toThrow(OraclePrivacyError)
  })

  it('rejects a personal value even under an innocent key', () => {
    const pii = personalDataFrom([PROFILE])
    expect(() => assertNoPersonalData({ note: `born ${PROFILE.birth_date}` }, pii)).toThrow(OraclePrivacyError)
    expect(() => assertNoPersonalData({ note: 'lives in Busan' }, pii)).toThrow(OraclePrivacyError)
    expect(() => assertNoPersonalData({ anchor: PROFILE.lat }, pii)).toThrow(OraclePrivacyError)
  })

  it('does not flag a payload built only from vectors and machine codes', () => {
    const pii = personalDataFrom([PROFILE])
    expect(() =>
      assertNoPersonalData(
        { traits: { drive: 55.3 }, reasons: { phase: ['saju.phase.daewoon_sewoon'] }, participating: ['saju', 'name'] },
        pii,
      ),
    ).not.toThrow()
  })

  it('splits multi-part names so a payload leaking only the given name is still caught', () => {
    const pii = personalDataFrom([PROFILE])
    expect(pii.names).toContain('Minseo')
    expect(pii.names).toContain('Kim')
  })
})

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return keys
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key)
      collectKeys(nested, keys)
    }
  }
  return keys
}

function computeSingle(system: 'tarot' | 'prism' | 'saju' | 'tzolkin' | 'runes' | 'iching' | 'ziwei' | 'astro' | 'numerology' | 'name' | 'ninestar' | 'sukuyou') {
  return runComputations({
    profile: PROFILE,
    systems: [system],
    seed: 'seed-privacy-single',
    asOfDate: AS_OF,
    locale: 'ko',
    kind: 'personal',
    question: null,
    sessionInputs: {
      ...SESSION_INPUTS,
      tarot: { spread: 5, pickedPositions: [14, 3, 71, 8, 22] },
      // New ritual shapes: hand-picked stones from the 24-stone cloth and a
      // user-cast 육효 (six three-coin throws, bottom-up).
      runes: { spread: 3, pickedPositions: [5, 12, 24] },
      iching: { lines: [7, 8, 9, 6, 7, 8] as const },
    },
    personalData: personalDataFrom([PROFILE]),
  })
}

describe('single-scope native charts', () => {
  it('drops the axis projection and never uses JSON key name', () => {
    const systems = [
      'tarot',
      'runes',
      'iching',
      'saju',
      'ziwei',
      'astro',
      'prism',
      'numerology',
      'name',
      'ninestar',
      'sukuyou',
      'tzolkin',
    ] as const
    for (const system of systems) {
      const entry = computeSingle(system).systems[0]!
      expect(entry.aiPayload, system).not.toBeNull()
      expect(entry.aiPayload!.readingInput).toBe('native')
      expect(entry.aiPayload!.traits, system).toBeUndefined()
      expect(entry.aiPayload!.elements, system).toBeUndefined()
      expect(entry.aiPayload!.phase, system).toBeUndefined()
      expect(entry.aiPayload!.chart, system).toBeTypeOf('object')
      const keys = collectKeys(entry.aiPayload)
      expect(keys.has('name'), `${system} leaked JSON key name`).toBe(false)
      expect(keys.has('seed'), `${system} leaked seed`).toBe(false)
      expect(keys.has('pickedPosition'), `${system} leaked pickedPosition`).toBe(false)
      expect(keys.has('instantUtc'), `${system} leaked instantUtc`).toBe(false)
      expect(keys.has('sex'), `${system} leaked sex`).toBe(false)
    }
  })

  it('still carries no birth date, time, place, name, coordinates, or timezone', () => {
    const pii = personalDataFrom([PROFILE])
    for (const system of ['tarot', 'prism', 'saju', 'tzolkin', 'name', 'astro', 'ziwei'] as const) {
      const payload = computeSingle(system).systems[0]!.aiPayload!
      const serialized = JSON.stringify(payload).toLowerCase()
      for (const literal of FORBIDDEN_LITERALS) {
        const needle = literal.toLowerCase()
        // Same rule as privacy.ts: ASCII name tokens use word boundaries, so
        // the Maya nawal "Kimi" is not a leak of surname "Kim".
        const leaked = /^[a-z]+$/.test(needle)
          ? new RegExp(`\\b${needle}\\b`).test(serialized)
          : serialized.includes(needle)
        expect(leaked, `${system} leaked "${literal}"`).toBe(false)
      }
      expect(isFreeOfPersonalData(payload, pii)).toBe(true)
    }
  })

  it('tarot chart names cards and positions, and does not carry 오행 mapping', () => {
    const payload = computeSingle('tarot').systems[0]!.aiPayload!
    const chart = payload.chart as { 카드: Array<{ 카드: string; 위치: string; 방향: string }> }
    expect(chart.카드).toHaveLength(5)
    expect(chart.카드.map((card) => card.위치)).toEqual(['상황', '방해', '조언', '외부', '결과'])
    for (const card of chart.카드) {
      expect(card.카드.length).toBeGreaterThan(0)
      expect(card.카드).not.toMatch(/Death|Hermit|Fool|Cups|Wands/)
      expect(['정방향', '역방향']).toContain(card.방향)
    }
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('수트→사원소→오행')
    expect(serialized).not.toContain('"drive"')
    expect(serialized).not.toContain('pickedPosition')
  })

  it('prism chart uses Korean colour names under 충동/필요/정체성, not English ids', () => {
    const payload = computeSingle('prism').systems[0]!.aiPayload!
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('"impulse"')
    expect(serialized).not.toContain('"need"')
    expect(serialized).not.toContain('"identity"')
    expect(serialized).not.toContain('"microCheck"')
    expect(serialized).not.toContain(PRISM_COLORS[0])
    expect(serialized).not.toContain(PRISM_COLORS[1])
    expect(serialized).not.toContain(PRISM_COLORS[2])
    expect(serialized).not.toContain('coreMatrix')
    expect(serialized).not.toContain('코어 매트릭스')
    const chart = payload.chart as { 색: { 충동: string; 필요: string; 정체성: string }; MBTI: string }
    expect(chart.MBTI).toBe('INTJ')
    expect(chart.색.충동.length).toBeGreaterThan(0)
    expect(chart.색.충동).not.toBe(PRISM_COLORS[0])
  })

  it('tzolkin chart uses the Yucatec nawal spelling, not maya.nawal.kim', () => {
    const payload = computeSingle('tzolkin').systems[0]!.aiPayload!
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('maya.nawal.kim')
    expect(serialized).not.toContain('nawal_kim')
    expect(serialized).not.toMatch(/\bKʼimʼ\b/)
  })
})

/**
 * FIX 1 guard: layer-1 readers get each system's NATIVE chart in EVERY mode
 * (single and combined alike) — the axis projection (traits/elements/phase
 * scores) flows ONLY to layer 2 (seer verdict payload) and the consensus
 * tally. Combined mode sending the projection to layer-1 was the disease
 * ("나무 기운 56.3" in a tarot reading); there is no axes variant to regress to.
 */
const AXIS_SCORE_KEYS = [
  // trait axes
  'drive', 'stability', 'relation', 'traits',
  // element axes (comparison scale — native charts use Korean vocabulary)
  'wood', 'fire', 'earth', 'metal', 'water', 'elements',
  // phase axes
  'advance', 'hold', 'release', 'phase',
  // projection plumbing
  'confidence', 'deficiency', 'excess', 'tally',
] as const

function expectNativeLayer1(payload: Record<string, unknown>, system: string) {
  expect(payload.readingInput, system).toBe('native')
  expect(payload.chart, system).toBeTypeOf('object')
  const keys = collectKeys(payload)
  for (const key of AXIS_SCORE_KEYS) {
    expect(keys.has(key), `${system} layer-1 payload contains axis key "${key}"`).toBe(false)
  }
}

describe('FIX 1: layer-1 payloads are native in BOTH modes; projection only reaches layer 2', () => {
  it('single mode: no layer-1 payload contains axis/element/phase scores', () => {
    for (const system of [
      'tarot', 'runes', 'iching', 'saju', 'ziwei', 'astro',
      'prism', 'numerology', 'name', 'ninestar', 'sukuyou', 'tzolkin',
    ] as const) {
      const entry = computeSingle(system).systems[0]!
      expect(entry.aiPayload, system).not.toBeNull()
      expectNativeLayer1(entry.aiPayload!, `single:${system}`)
    }
  })

  it('combined mode: no layer-1 payload contains axis/element/phase scores — all 12 at once', () => {
    const computed = computeAll()
    const withPayload = computed.systems.filter((entry) => entry.aiPayload !== null)
    expect(withPayload.length).toBeGreaterThanOrEqual(11)
    for (const entry of withPayload) {
      expectNativeLayer1(entry.aiPayload!, `combined:${entry.system}`)
    }
  })

  it('the seer verdict payload keeps the axis-projection consensus (layer 2 is its home)', () => {
    const computed = computeAll()
    const votes = computed.systems.flatMap((entry) => (entry.vote ? [entry.vote] : []))
    const consensus = computeConsensus(votes, { readingScope: 'life' })
    const payload = buildVerdictPayload(
      {
        readerSlug: 'contrarian',
        readerIndex: 5,
        readerCount: 5,
        consensus,
        readings: [],
      },
      { kind: 'personal', locale: 'ko', readingScope: 'life', asOfDate: AS_OF, question: null },
      personalDataFrom([PROFILE]),
    )
    expect(payload.readingInput).toBe('axes')
    const consensusBlock = payload.consensus as { phase?: { tally?: unknown; oppositions?: unknown } }
    expect(consensusBlock.phase?.tally).toBeDefined()
    expect(consensusBlock.phase?.oppositions).toBeDefined()
  })

  it('the synthesis payload also keeps the consensus (code-tallied, never AI-tallied)', () => {
    const computed = computeAll()
    const payload = buildSynthesisPayload([], computed.consensus, personalDataFrom([PROFILE]))
    const consensusBlock = payload.consensus as { phase?: { tally?: unknown } }
    expect(consensusBlock.phase?.tally).toBeDefined()
  })
})
