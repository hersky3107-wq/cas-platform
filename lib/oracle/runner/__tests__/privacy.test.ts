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
import { PRISM_COLORS } from '../../engines/prism'
import { personalDataFrom, runComputations } from '../compute'
import { buildVerdictPayload, MACHINE_CODE_FIELDS } from '../payload'
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
        expect(serialized, `${entry.system} leaked "${literal}"`).not.toContain(literal.toLowerCase())
      }
      expect(isFreeOfPersonalData(entry.aiPayload, pii, { machineCodeFields: MACHINE_CODE_FIELDS })).toBe(true)
    }
  })

  it('machine-code fields hold codes plus parallel labels — code matches pattern', () => {
    const computed = computeAll()
    for (const entry of computed.systems) {
      if (entry.aiPayload === null) continue
      const reasons = entry.aiPayload.reasons as Record<string, string[] | undefined>
      const labels = entry.aiPayload.labels as Record<string, string[] | undefined>
      for (const space of Object.keys(reasons)) {
        for (const code of reasons[space] ?? []) {
          expect(code, `${entry.system} reason "${code}"`).toMatch(MACHINE_CODE_PATTERN)
        }
        const spaceLabels = labels?.[space] ?? []
        expect(spaceLabels.length).toBe((reasons[space] ?? []).length)
        for (const label of spaceLabels) {
          expect(typeof label).toBe('string')
          expect(label.length).toBeGreaterThan(0)
        }
      }
      const unreadable = entry.aiPayload.unreadable as Array<{ space: string; code: string; label: string }>
      for (const item of unreadable) {
        expect(item.code).toMatch(MACHINE_CODE_PATTERN)
        expect(item.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('saju peer_dominant carries the Korean ten-god label 비견', () => {
    const computed = computeAll()
    const saju = computed.systems.find((entry) => entry.system === 'saju')
    const reasons = saju?.aiPayload?.reasons as { traits?: string[] } | undefined
    const labels = saju?.aiPayload?.labels as { traits?: string[] } | undefined
    const idx = reasons?.traits?.indexOf('saju.tengods.peer_dominant') ?? -1
    if (idx >= 0) expect(labels?.traits?.[idx]).toBe('비견')
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
