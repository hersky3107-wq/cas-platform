import { describe, expect, it } from 'vitest'
import { SYSTEM_IDS } from '../../axes/types'
import {
  ORACLE_FAMILY_ROSTERS,
  ORACLE_SINGLE_READER_COUNTS,
  SYSTEM_FAMILY,
  isAllowedReaderCount,
  resolveSingleSystemRoster,
  synthesizerByFamily,
  type OracleFamilyBrand,
} from '../family-roster'

describe('family-roster', () => {
  it('rejects reader_count=9 for single; allows 3/5/7', () => {
    expect(isAllowedReaderCount('single', 9)).toBe(false)
    expect(isAllowedReaderCount('combined', 9)).toBe(true)
    for (const n of ORACLE_SINGLE_READER_COUNTS) {
      expect(isAllowedReaderCount('single', n)).toBe(true)
    }
  })

  it('assigns a different synthesizer per family', () => {
    const synths = synthesizerByFamily().map((s) => s.synthesizer)
    expect(new Set(synths).size).toBe(4)
    expect(ORACLE_FAMILY_ROSTERS.western_chart.synthesizer).not.toBe('OpenAI')
  })

  it('resolves every system at N=3/5/7 with no duplicate brands and synth not a reader', () => {
    for (const system of SYSTEM_IDS) {
      for (const n of ORACLE_SINGLE_READER_COUNTS) {
        const resolved = resolveSingleSystemRoster(system, n)
        expect(resolved.readers).toHaveLength(n)
        expect(new Set(resolved.readers).size).toBe(n)
        expect(resolved.readers).not.toContain(resolved.synthesizer)
        expect(resolved.family).toBe(SYSTEM_FAMILY[system])
        expect(resolved.readers[0]).toBe(ORACLE_FAMILY_ROSTERS[resolved.family].readers[0])
      }
    }
  })

  it('marks zero-evidence systems as family inheritance targets', () => {
    const zeroEvidence: Array<[string, string]> = [
      ['ninestar', 'east_asian'],
      ['sukuyou', 'east_asian'],
      ['name', 'east_asian'],
      ['iching', 'draw_based'],
      ['tzolkin', 'self_ip'],
      ['prism', 'self_ip'],
    ]
    for (const [system, family] of zeroEvidence) {
      expect(SYSTEM_FAMILY[system as keyof typeof SYSTEM_FAMILY]).toBe(family)
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

  it('locks accepted seat-1 brands', () => {
    const seat1: Record<string, OracleFamilyBrand> = {
      east_asian: 'Z.ai',
      draw_based: 'xAI',
      western_chart: 'Moonshot AI',
      self_ip: 'Moonshot AI',
    }
    for (const [id, brand] of Object.entries(seat1)) {
      expect(ORACLE_FAMILY_ROSTERS[id as keyof typeof ORACLE_FAMILY_ROSTERS].readers[0]).toBe(brand)
    }
  })
})
