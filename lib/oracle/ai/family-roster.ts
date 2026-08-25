/**
 * Per-family / per-system reader + synthesizer roster for Oracle sessions.
 *
 * Synthesis assignments come from docs/oracle-synthesis-bakeoff.md plus the
 * DeepSeek/Anthropic clean re-run (docs/oracle-synthesis-rerun-spoiled.json).
 * Reader seats come from layer-1 bakeoffs. OpenAI is excluded from every
 * synthesizer seat until it passes a synthesis re-run.
 *
 * Systems with zero system-level bakeoff evidence inherit their family's
 * default seat order (evidence-by-family) — marked on SYSTEM_READER_ROSTERS.
 */
import type { SystemId } from '../axes/types'
import { ORACLE_READER_COUNTS, type OracleReaderCount, type OracleSessionScope } from '../schema'
import { integratedReaderBrands } from './registry'

/** Brands eligible for family reader / synthesizer seats (English display). */
export type OracleFamilyBrand =
  | 'Z.ai'
  | 'Moonshot AI'
  | 'xAI'
  | 'NVIDIA'
  | 'DeepSeek'
  | 'Google'
  | 'OpenAI'
  | 'Anthropic'

export type OracleFamilyId = 'east_asian' | 'draw_based' | 'western_chart' | 'self_ip'

export type OracleFamilyRoster = {
  id: OracleFamilyId
  label: string
  systems: readonly SystemId[]
  /**
   * Family-default seats 1–5. Used only by evidence-by-family systems.
   * Single-mode seat 1 is quality-ranked for that family — it is NOT the
   * integrated LAYER1_REGISTRY "dedicated brand" (that concept applies only
   * to combined/integrated one-model-per-system routing).
   */
  readers: readonly OracleFamilyBrand[]
  overflowReaders: readonly OracleFamilyBrand[]
  synthesizer: OracleFamilyBrand
  synthesizerCite: string
}

export type SystemReaderRoster = {
  system: SystemId
  family: OracleFamilyId
  /** 'system' = measured bakeoff for this system; 'family' = inherited default. */
  evidence: 'system' | 'family'
  readers: readonly OracleFamilyBrand[]
  overflowReaders: readonly OracleFamilyBrand[]
}

/**
 * Single-system product rule: odd reader counts 3/5/7 only.
 * Combined (integrated) may still use 9 for the seer persona panel.
 */
export const ORACLE_SINGLE_READER_COUNTS = [3, 5, 7] as const satisfies readonly OracleReaderCount[]
export type OracleSingleReaderCount = (typeof ORACLE_SINGLE_READER_COUNTS)[number]

export function isAllowedReaderCount(scope: OracleSessionScope, readerCount: number): boolean {
  if (scope === 'single') {
    return (ORACLE_SINGLE_READER_COUNTS as readonly number[]).includes(readerCount)
  }
  return (ORACLE_READER_COUNTS as readonly number[]).includes(readerCount)
}

/**
 * Family defaults + synthesizers (synthesis-bakeoff evidence only).
 * Each synthesizer is excluded from that family's reader/overflow pools.
 *
 * Clean single-panel pool after spoiled re-runs: NVIDIA, DeepSeek, Moonshot.
 * Anthropic clean re-run DQ (universal conclusion); OpenAI excluded.
 * Google used only where the clean pool is exhausted (self_ip).
 */
export const ORACLE_FAMILY_ROSTERS: Record<OracleFamilyId, OracleFamilyRoster> = {
  east_asian: {
    id: 'east_asian',
    label: 'East-Asian calendrical',
    systems: ['saju', 'ziwei', 'ninestar', 'sukuyou', 'name'],
    // NVIDIA = synth (removed from readers). Default for evidence-by-family.
    readers: ['Z.ai', 'Moonshot AI', 'xAI', 'DeepSeek', 'Anthropic'],
    overflowReaders: ['OpenAI', 'Google'],
    synthesizer: 'NVIDIA',
    synthesizerCite:
      'synthesis bakeoff single #1 (0 univ-conclusion DQ); off east_asian reader panels; OpenAI excluded',
  },
  draw_based: {
    id: 'draw_based',
    label: 'Draw-based',
    systems: ['tarot', 'runes', 'iching'],
    // DeepSeek = synth after clean re-run (DQ=false on single).
    readers: ['xAI', 'Google', 'NVIDIA', 'Z.ai', 'Moonshot AI'],
    overflowReaders: ['OpenAI', 'Anthropic'],
    synthesizer: 'DeepSeek',
    synthesizerCite:
      'synthesis clean re-run single DQ=false, ground=121; off draw_based readers; OpenAI excluded',
  },
  western_chart: {
    id: 'western_chart',
    label: 'Western chart',
    systems: ['astro'],
    // Moonshot = synth (single #3). NVIDIA already assigned to east_asian.
    readers: ['DeepSeek', 'Anthropic', 'xAI', 'Z.ai', 'Google'],
    overflowReaders: ['OpenAI', 'NVIDIA'],
    synthesizer: 'Moonshot AI',
    synthesizerCite:
      'synthesis bakeoff single #3 (0 univ-conclusion DQ); not on western readers; varies from east_asian NVIDIA',
  },
  self_ip: {
    id: 'self_ip',
    label: 'Self-IP / number',
    systems: ['prism', 'numerology', 'tzolkin'],
    // Google = numerology single-panel synth #4 (0 univ DQ); not on self_ip
    // readers at N=3/5/7. Moonshot/xAI/NVIDIA ranked higher but collide
    // (western/east synth or self_ip reader seats). OpenAI #5 held out.
    readers: ['Z.ai', 'Anthropic', 'DeepSeek', 'xAI', 'NVIDIA'],
    overflowReaders: ['OpenAI', 'Moonshot AI'],
    synthesizer: 'Google',
    synthesizerCite:
      'numerology single-panel synthesis bakeoff #4 (0 univ-conclusion DQ); not on self_ip readers; OpenAI excluded',
  },
}

/** Integrated (combined) synthesizer — must NOT be any LAYER1 dedicated reader. */
export const INTEGRATED_SYNTHESIZER_BRAND: OracleFamilyBrand = 'Z.ai'
export const INTEGRATED_SYNTHESIZER_CITE =
  'synthesis bakeoff integrated #1 (0 univ-conclusion DQ); removed from LAYER1 (iching→Qwen) so synth∉12 readers; OpenAI excluded'

/**
 * Assert synthesizer is never a reader in the same session.
 * - Single: checks every system at N=3/5/7.
 * - Integrated: synthesizer ∉ LAYER1 dedicated brands.
 */
export function assertSynthesizerNeverReader(): void {
  const integratedReaders = new Set(integratedReaderBrands())
  if (integratedReaders.has(INTEGRATED_SYNTHESIZER_BRAND)) {
    throw new Error(
      `integrated synthesizer ${INTEGRATED_SYNTHESIZER_BRAND} collides with a LAYER1 reader`,
    )
  }
  for (const system of Object.keys(SYSTEM_FAMILY) as SystemId[]) {
    for (const n of ORACLE_SINGLE_READER_COUNTS) {
      resolveSingleSystemRoster(system, n)
    }
  }
}

/**
 * Per-system seat orders. Measured systems differ at N=3 within a family.
 * Evidence-by-family systems copy ORACLE_FAMILY_ROSTERS defaults.
 */
export const SYSTEM_READER_ROSTERS: Record<SystemId, SystemReaderRoster> = {
  // saju: Z.ai #1, xAI #2, DeepSeek #3… (NVIDIA = family synth, removed)
  saju: {
    system: 'saju',
    family: 'east_asian',
    evidence: 'system',
    readers: ['Z.ai', 'xAI', 'DeepSeek', 'Moonshot AI', 'Anthropic'],
    overflowReaders: ['OpenAI', 'Google'],
  },
  // ziwei: Moonshot #1, Z.ai #3, xAI #4… (NVIDIA was #2 — family synth, removed)
  ziwei: {
    system: 'ziwei',
    family: 'east_asian',
    evidence: 'system',
    readers: ['Moonshot AI', 'Z.ai', 'xAI', 'DeepSeek', 'Anthropic'],
    overflowReaders: ['OpenAI', 'Google'],
  },
  ninestar: {
    system: 'ninestar',
    family: 'east_asian',
    evidence: 'family',
    readers: ORACLE_FAMILY_ROSTERS.east_asian.readers,
    overflowReaders: ORACLE_FAMILY_ROSTERS.east_asian.overflowReaders,
  },
  sukuyou: {
    system: 'sukuyou',
    family: 'east_asian',
    evidence: 'family',
    readers: ORACLE_FAMILY_ROSTERS.east_asian.readers,
    overflowReaders: ORACLE_FAMILY_ROSTERS.east_asian.overflowReaders,
  },
  name: {
    system: 'name',
    family: 'east_asian',
    evidence: 'family',
    readers: ORACLE_FAMILY_ROSTERS.east_asian.readers,
    overflowReaders: ORACLE_FAMILY_ROSTERS.east_asian.overflowReaders,
  },
  // tarot: Moonshot elevated vs runes; N=3 ≠ runes (DeepSeek = synth)
  tarot: {
    system: 'tarot',
    family: 'draw_based',
    evidence: 'system',
    readers: ['Moonshot AI', 'xAI', 'Google', 'NVIDIA', 'Z.ai'],
    overflowReaders: ['OpenAI', 'Anthropic'],
  },
  // runes: xAI #1, Google #2, NVIDIA #3, Z.ai #4, Moonshot #6
  runes: {
    system: 'runes',
    family: 'draw_based',
    evidence: 'system',
    readers: ['xAI', 'Google', 'NVIDIA', 'Z.ai', 'Moonshot AI'],
    overflowReaders: ['OpenAI', 'Anthropic'],
  },
  iching: {
    system: 'iching',
    family: 'draw_based',
    evidence: 'family',
    readers: ORACLE_FAMILY_ROSTERS.draw_based.readers,
    overflowReaders: ORACLE_FAMILY_ROSTERS.draw_based.overflowReaders,
  },
  // astro: DeepSeek #2, Anthropic #3… (Moonshot = synth, removed)
  astro: {
    system: 'astro',
    family: 'western_chart',
    evidence: 'system',
    readers: ['DeepSeek', 'Anthropic', 'xAI', 'Z.ai', 'Google'],
    overflowReaders: ['OpenAI', 'NVIDIA'],
  },
  // numerology: Z.ai #2, Anthropic #4… (Google = synth, Moonshot demoted to overflow)
  numerology: {
    system: 'numerology',
    family: 'self_ip',
    evidence: 'system',
    readers: ['Z.ai', 'Anthropic', 'DeepSeek', 'xAI', 'NVIDIA'],
    overflowReaders: ['OpenAI', 'Moonshot AI'],
  },
  prism: {
    system: 'prism',
    family: 'self_ip',
    evidence: 'family',
    readers: ORACLE_FAMILY_ROSTERS.self_ip.readers,
    overflowReaders: ORACLE_FAMILY_ROSTERS.self_ip.overflowReaders,
  },
  tzolkin: {
    system: 'tzolkin',
    family: 'self_ip',
    evidence: 'family',
    readers: ORACLE_FAMILY_ROSTERS.self_ip.readers,
    overflowReaders: ORACLE_FAMILY_ROSTERS.self_ip.overflowReaders,
  },
}

/** System → family. */
export const SYSTEM_FAMILY: Record<SystemId, OracleFamilyId> = {
  saju: 'east_asian',
  ziwei: 'east_asian',
  ninestar: 'east_asian',
  sukuyou: 'east_asian',
  name: 'east_asian',
  tarot: 'draw_based',
  runes: 'draw_based',
  iching: 'draw_based',
  astro: 'western_chart',
  numerology: 'self_ip',
  prism: 'self_ip',
  tzolkin: 'self_ip',
}

export type ResolvedSessionRoster = {
  family: OracleFamilyId
  system: SystemId
  readerCount: OracleSingleReaderCount
  readers: OracleFamilyBrand[]
  synthesizer: OracleFamilyBrand
  synthesizerCite: string
  evidence: 'system' | 'family'
}

/**
 * Resolve single-system brand seats for N readers + family synthesizer.
 * Asserts no duplicate brands and synthesizer ∉ readers.
 *
 * Seat 1 is the quality-ranked lead for this system (or family default).
 * It is intentionally NOT required to equal LAYER1_REGISTRY[system].brand —
 * that "dedicated brand" applies only to integrated one-model-per-system mode.
 */
export function resolveSingleSystemRoster(
  system: SystemId,
  readerCount: number,
): ResolvedSessionRoster {
  if (!(ORACLE_SINGLE_READER_COUNTS as readonly number[]).includes(readerCount)) {
    throw new Error(`single-system readerCount must be 3, 5, or 7 (got ${readerCount})`)
  }
  const systemRoster = SYSTEM_READER_ROSTERS[system]
  const family = ORACLE_FAMILY_ROSTERS[systemRoster.family]
  const pool = [...systemRoster.readers, ...systemRoster.overflowReaders]
  const readers = pool.slice(0, readerCount) as OracleFamilyBrand[]
  if (readers.length !== readerCount) {
    throw new Error(`system ${system} has fewer than ${readerCount} reader seats`)
  }
  const unique = new Set(readers)
  if (unique.size !== readers.length) {
    throw new Error(`duplicate reader brand in ${system} roster`)
  }
  if (unique.has(family.synthesizer)) {
    throw new Error(
      `synthesizer ${family.synthesizer} collides with a reader for ${system}`,
    )
  }
  return {
    family: systemRoster.family,
    system,
    readerCount: readerCount as OracleSingleReaderCount,
    readers,
    synthesizer: family.synthesizer,
    synthesizerCite: family.synthesizerCite,
    evidence: systemRoster.evidence,
  }
}

/** Printable synthesizer table for ops / docs. */
export function synthesizerByFamily(): Array<{
  family: OracleFamilyId
  synthesizer: OracleFamilyBrand
  cite: string
}> {
  return (Object.keys(ORACLE_FAMILY_ROSTERS) as OracleFamilyId[]).map((id) => {
    const f = ORACLE_FAMILY_ROSTERS[id]
    return { family: id, synthesizer: f.synthesizer, cite: f.synthesizerCite }
  })
}

export function resolvedSingleSystemRosterTable(): Array<{
  system: SystemId
  evidence: string
  n3: string
  n5: string
  n7: string
  synthesizer: string
  ok357: boolean
}> {
  return (Object.keys(SYSTEM_FAMILY) as SystemId[]).map((system) => {
    const n3 = resolveSingleSystemRoster(system, 3)
    const n5 = resolveSingleSystemRoster(system, 5)
    const n7 = resolveSingleSystemRoster(system, 7)
    const ok357 =
      !n3.readers.includes(n3.synthesizer) &&
      !n5.readers.includes(n5.synthesizer) &&
      !n7.readers.includes(n7.synthesizer)
    return {
      system,
      evidence: n3.evidence,
      n3: n3.readers.join(', '),
      n5: n5.readers.join(', '),
      n7: n7.readers.join(', '),
      synthesizer: n7.synthesizer,
      ok357,
    }
  })
}
