import { describe, expect, it } from 'vitest'
import { SYSTEM_IDS } from '../../axes/types'
import { LAYER1_REGISTRY } from '../registry'
import {
  INTEGRATED_SYNTHESIZER_BRAND,
  ORACLE_FAMILY_ROSTERS,
  ORACLE_SINGLE_READER_COUNTS,
  SYSTEM_FAMILY,
  SYSTEM_READER_ROSTERS,
  isAllowedReaderCount,
  resolveSingleSystemRoster,
  synthesizerByFamily,
} from '../family-roster'

describe('family-roster', () => {
  it('rejects reader_count=9 for single; allows 3/5/7', () => {
    expect(isAllowedReaderCount('single', 9)).toBe(false)
    expect(isAllowedReaderCount('combined', 9)).toBe(true)
    for (const n of ORACLE_SINGLE_READER_COUNTS) {
      expect(isAllowedReaderCount('single', n)).toBe(true)
    }
  })

  it('assigns a different synthesizer per family and keeps OpenAI off synth seats', () => {
    const synths = synthesizerByFamily().map((s) => s.synthesizer)
    expect(new Set(synths).size).toBe(4)
    expect(synths).not.toContain('OpenAI')
    expect(INTEGRATED_SYNTHESIZER_BRAND).not.toBe('OpenAI')
  })

  it('resolves every system at N=3/5/7 with no duplicate brands and synth not a reader', () => {
    for (const system of SYSTEM_IDS) {
      for (const n of ORACLE_SINGLE_READER_COUNTS) {
        const resolved = resolveSingleSystemRoster(system, n)
        expect(resolved.readers).toHaveLength(n)
        expect(new Set(resolved.readers).size).toBe(n)
        expect(resolved.readers).not.toContain(resolved.synthesizer)
        expect(resolved.family).toBe(SYSTEM_FAMILY[system])
        // Seat 1 is quality-ranked for this system — NOT LAYER1_REGISTRY dedicated brand.
        expect(resolved.readers[0]).toBe(SYSTEM_READER_ROSTERS[system].readers[0])
      }
    }
  })

  it('does not require seat 1 to equal the integrated dedicated brand', () => {
    const saju = resolveSingleSystemRoster('saju', 3)
    expect(LAYER1_REGISTRY.saju.brand).toBe('Moonshot AI')
    expect(saju.readers[0]).toBe('Z.ai')
    expect(saju.readers[0]).not.toBe(LAYER1_REGISTRY.saju.brand)
  })

  it('gives evidence-backed systems distinct N=3 panels within a family', () => {
    const byFamily = new Map<string, Array<{ system: string; n3: string }>>()
    for (const system of SYSTEM_IDS) {
      const roster = SYSTEM_READER_ROSTERS[system]
      if (roster.evidence !== 'system') continue
      const n3 = resolveSingleSystemRoster(system, 3).readers.join(',')
      const rows = byFamily.get(roster.family) ?? []
      rows.push({ system, n3 })
      byFamily.set(roster.family, rows)
    }
    for (const [family, rows] of byFamily) {
      if (rows.length < 2) continue
      const panels = rows.map((r) => r.n3)
      expect(new Set(panels).size, `${family} N=3 panels should differ`).toBe(panels.length)
    }
  })

  it('marks zero-evidence systems as family inheritance targets', () => {
    for (const system of ['ninestar', 'sukuyou', 'name', 'iching', 'tzolkin', 'prism'] as const) {
      expect(SYSTEM_READER_ROSTERS[system].evidence).toBe('family')
    }
  })

  it('keeps synthesizer cites non-empty', () => {
    for (const row of synthesizerByFamily()) {
      expect(row.cite.length).toBeGreaterThan(10)
      expect(row.synthesizer.length).toBeGreaterThan(0)
    }
  })

  it('throws when single-system N is 9', () => {
    expect(() => resolveSingleSystemRoster('saju', 9)).toThrow(/3, 5, or 7/)
  })

  it('locks family-default seat-1 brands for inheritance only', () => {
    expect(ORACLE_FAMILY_ROSTERS.east_asian.readers[0]).toBe('Z.ai')
    expect(ORACLE_FAMILY_ROSTERS.draw_based.readers[0]).toBe('xAI')
    expect(ORACLE_FAMILY_ROSTERS.western_chart.readers[0]).toBe('DeepSeek')
    expect(ORACLE_FAMILY_ROSTERS.self_ip.readers[0]).toBe('Z.ai')
  })
})
