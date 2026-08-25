/**
 * Per-family reader + synthesizer roster for single-system Oracle sessions.
 *
 * Accepted from the family bakeoffs (saju, ziwei, tarot, runes, astro,
 * numerology) with corrections:
 * - Different synthesizer brand per family (never OpenAI for all four).
 * - Astro synthesizer is not OpenAI (ranked #8 on astro — demoted from seat 1).
 * - Synthesizer is never also a reader in the same session.
 *
 * Systems with zero system-level bakeoff evidence inherit their family's
 * roster (evidence-by-family, not evidence-by-system) — marked below.
 */
import type { SystemId } from '../axes/types'
import { ORACLE_READER_COUNTS, type OracleReaderCount, type OracleSessionScope } from '../schema'

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
  /** Seats 1–5 in product order. */
  readers: readonly OracleFamilyBrand[]
  /**
   * Seats 6–7 when N=7: remaining eligible brands (not MiniMax/Mistral/Meta/NAVER),
   * not already readers, and not the family synthesizer — ordered by that family's
   * bakeoff preference.
   */
  overflowReaders: readonly OracleFamilyBrand[]
  synthesizer: OracleFamilyBrand
  /** Bakeoff cite justifying the synthesizer pick. */
  synthesizerCite: string
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

export const ORACLE_FAMILY_ROSTERS: Record<OracleFamilyId, OracleFamilyRoster> = {
  east_asian: {
    id: 'east_asian',
    label: 'East-Asian calendrical',
    systems: ['saju', 'ziwei', 'ninestar', 'sukuyou', 'name'],
    // saju: Z.ai #1; ziwei: Moonshot #1, NVIDIA #2, Z.ai #3, xAI #4; DeepSeek saju #3 / ziwei hold
    readers: ['Z.ai', 'Moonshot AI', 'xAI', 'NVIDIA', 'DeepSeek'],
    // Remaining eligibles after readers + OpenAI synth: Google, Anthropic (ziwei #5 / #8)
    overflowReaders: ['Anthropic', 'Google'],
    // Off-panel; saju bakeoff #7 (0 fab, consistent). Not Anthropic (ziwei #5) — keep Anthropic free for self_ip readers.
    synthesizer: 'OpenAI',
    synthesizerCite: 'saju bakeoff rank #7 (0 fab); not on east_asian reader panel',
  },
  draw_based: {
    id: 'draw_based',
    label: 'Draw-based',
    systems: ['tarot', 'runes', 'iching'],
    // runes: xAI #1, Google #2 (thinkingLevel:minimal), NVIDIA #3, Z.ai #4; tarot: Moonshot #3 among eligibles
    readers: ['xAI', 'Google', 'NVIDIA', 'Z.ai', 'Moonshot AI'],
    // Remaining after DeepSeek synth: OpenAI (tarot #4), Anthropic
    overflowReaders: ['OpenAI', 'Anthropic'],
    // Off-panel; runes #5 (0 fab). Distinct from east_asian OpenAI synth.
    synthesizer: 'DeepSeek',
    synthesizerCite: 'runes bakeoff rank #5 (0 fab); not on draw_based reader panel',
  },
  western_chart: {
    id: 'western_chart',
    label: 'Western chart',
    systems: ['astro'],
    // astro bakeoff: Moonshot #1, DeepSeek #2, xAI #4, Z.ai #5, Anthropic #3 — OpenAI demoted (#8)
    readers: ['Moonshot AI', 'DeepSeek', 'xAI', 'Z.ai', 'Anthropic'],
    // Remaining after Google synth: NVIDIA (#7) then OpenAI (#8)
    overflowReaders: ['NVIDIA', 'OpenAI'],
    // CORRECTION 1: not OpenAI (#8). Best off-panel scorer is Google (#6, 0 fab).
    synthesizer: 'Google',
    synthesizerCite: 'astro bakeoff rank #6 (0 fab); OpenAI #8 excluded from synth; not on western reader panel',
  },
  self_ip: {
    id: 'self_ip',
    label: 'Self-IP / number',
    systems: ['prism', 'numerology', 'tzolkin'],
    // numerology: Moonshot #1, Z.ai #2, Anthropic #4, DeepSeek #5, Google #3 (post label-evidence fix)
    readers: ['Moonshot AI', 'Z.ai', 'Anthropic', 'DeepSeek', 'Google'],
    // Remaining after xAI synth: OpenAI (#7), NVIDIA (#8)
    overflowReaders: ['OpenAI', 'NVIDIA'],
    // Off-panel; numerology #6. Distinct synth brand.
    synthesizer: 'xAI',
    synthesizerCite: 'numerology bakeoff rank #6 (0 real fab after label-evidence fix); not on self_ip reader panel',
  },
}

/** System → family. Zero-evidence systems inherit family roster (see comments). */
export const SYSTEM_FAMILY: Record<SystemId, OracleFamilyId> = {
  saju: 'east_asian',
  ziwei: 'east_asian',
  // evidence-by-family (not evidence-by-system): no bakeoff; inherits east_asian
  ninestar: 'east_asian',
  // evidence-by-family (not evidence-by-system): no bakeoff; inherits east_asian
  sukuyou: 'east_asian',
  // evidence-by-family (not evidence-by-system): no bakeoff; inherits east_asian
  name: 'east_asian',
  tarot: 'draw_based',
  runes: 'draw_based',
  // evidence-by-family (not evidence-by-system): no bakeoff; inherits draw_based
  iching: 'draw_based',
  astro: 'western_chart',
  numerology: 'self_ip',
  // evidence-by-family (not evidence-by-system): smoke length-lock only; inherits self_ip
  prism: 'self_ip',
  // evidence-by-family (not evidence-by-system): no bakeoff; inherits self_ip
  tzolkin: 'self_ip',
}

export type ResolvedSessionRoster = {
  family: OracleFamilyId
  system: SystemId
  readerCount: OracleSingleReaderCount
  readers: OracleFamilyBrand[]
  synthesizer: OracleFamilyBrand
  synthesizerCite: string
}

/**
 * Resolve single-system brand seats for N readers + family synthesizer.
 * Asserts no duplicate brands and synthesizer ∉ readers.
 */
export function resolveSingleSystemRoster(
  system: SystemId,
  readerCount: number,
): ResolvedSessionRoster {
  if (!(ORACLE_SINGLE_READER_COUNTS as readonly number[]).includes(readerCount)) {
    throw new Error(`single-system readerCount must be 3, 5, or 7 (got ${readerCount})`)
  }
  const familyId = SYSTEM_FAMILY[system]
  const family = ORACLE_FAMILY_ROSTERS[familyId]
  const pool = [...family.readers, ...family.overflowReaders]
  const readers = pool.slice(0, readerCount) as OracleFamilyBrand[]
  if (readers.length !== readerCount) {
    throw new Error(`family ${familyId} has fewer than ${readerCount} reader seats`)
  }
  const unique = new Set(readers)
  if (unique.size !== readers.length) {
    throw new Error(`duplicate reader brand in ${familyId} roster for ${system}`)
  }
  if (unique.has(family.synthesizer)) {
    throw new Error(
      `synthesizer ${family.synthesizer} collides with a reader in ${familyId} (system ${system})`,
    )
  }
  return {
    family: familyId,
    system,
    readerCount: readerCount as OracleSingleReaderCount,
    readers,
    synthesizer: family.synthesizer,
    synthesizerCite: family.synthesizerCite,
  }
}

/** Integrated (combined) synthesizer brand for cost / wiring until a dedicated non-overlapping seat exists. */
export const INTEGRATED_SYNTHESIZER_BRAND: OracleFamilyBrand = 'OpenAI'
export const INTEGRATED_SYNTHESIZER_CITE =
  'Integrated layer-1 still uses one brand per system (LAYER1_REGISTRY); OpenAI synth overlaps astro until that map changes. Single-system uses per-family synths below.'

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
  n3: string
  n5: string
  n7: string
  synthesizer: string
}> {
  return (Object.keys(SYSTEM_FAMILY) as SystemId[]).map((system) => {
    const n3 = resolveSingleSystemRoster(system, 3)
    const n5 = resolveSingleSystemRoster(system, 5)
    const n7 = resolveSingleSystemRoster(system, 7)
    return {
      system,
      n3: n3.readers.join(', '),
      n5: n5.readers.join(', '),
      n7: n7.readers.join(', '),
      synthesizer: n7.synthesizer,
    }
  })
}

