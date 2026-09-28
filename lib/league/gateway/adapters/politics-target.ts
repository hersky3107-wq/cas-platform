/**
 * Politics target search — person→race or office→race inside the 3-month slate.
 * Vague input is refused. Pure.
 */

import { MAX_TARGET_PICKS, type TargetSearchResult } from '../target-resolve'
import type { ElectionCandidateLite } from '../../politics/markets'
import {
  candidateMatches,
  extractPoliticsMentions,
  instrumentForCandidate,
  politicsChipLabel,
  slateNamesInText,
  withinPoliticsHorizon,
} from './politics-catalog'

const VAGUE =
  /당선될까|누가\s*당선|누가\s*이길|who\s+wins|will\s+.+\s+win|선거\s*결과/i

export function politicsWindow(slate: readonly ElectionCandidateLite[], now: Date): ElectionCandidateLite[] {
  return slate
    .filter((row) => withinPoliticsHorizon(Date.parse(row.pollCloseIso), now))
    .sort((a, b) => Date.parse(a.pollCloseIso) - Date.parse(b.pollCloseIso))
}

function picksFor(rows: readonly ElectionCandidateLite[]): TargetSearchResult {
  const options = []
  for (const row of rows) {
    const id = instrumentForCandidate(row)
    if (!id) continue
    options.push({ id, label: politicsChipLabel(row) })
    if (options.length >= MAX_TARGET_PICKS) break
  }
  if (options.length === 0) return { kind: 'unsupported' }
  if (options.length === 1) return { kind: 'ready', entityId: options[0]!.id, label: options[0]!.label, skipConfirm: true }
  return { kind: 'picks', options }
}

function personNames(raw: string, slate: readonly ElectionCandidateLite[]): string[] {
  const mentions = extractPoliticsMentions(raw).filter((m) => m.kind === 'person').map((m) => m.canonical)
  const fromSlate = slateNamesInText(raw, slate)
  const out: string[] = []
  for (const name of [...mentions, ...fromSlate]) {
    if (!out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name)
  }
  return out
}

/**
 * First named person is the subject. An office without a person lists that race's candidates.
 */
export function resolvePoliticsTarget(
  raw: string,
  slate: readonly ElectionCandidateLite[],
  now: Date,
): TargetSearchResult {
  const text = raw.trim()
  if (!text) return { kind: 'vague' }
  const window = politicsWindow(slate, now)
  const people = personNames(text, window.length ? window : slate)
  const office = extractPoliticsMentions(text).find((m) => m.kind === 'office')

  if (people.length > 0) {
    const name = people[0]!
    const hits = window.filter((row) => candidateMatches(row, name))
    if (hits.length > 0) return picksFor(hits)
    const past = slate.filter((row) => Date.parse(row.pollCloseIso) <= now.getTime() && candidateMatches(row, name))
    if (past.length > 0 && window.every((row) => !candidateMatches(row, name))) return { kind: 'past' }
    const later = slate.filter((row) => Date.parse(row.pollCloseIso) > now.getTime() + 1 && candidateMatches(row, name))
    if (later.length > 0) return { kind: 'unsupported' }
    return { kind: 'unsupported' }
  }

  if (office?.office) {
    const district = office.district && office.district !== '_' ? office.district : null
    const hits = window.filter((row) => {
      if (row.office !== office.office) return false
      if (!district) return true
      return row.district.toUpperCase() === district.toUpperCase()
    })
    if (!district && hits.length > MAX_TARGET_PICKS) return { kind: 'vague' }
    if (hits.length > 0) return picksFor(hits)
    return { kind: 'unsupported' }
  }

  if (VAGUE.test(text) || text.length < 12) return { kind: 'vague' }
  return { kind: 'vague' }
}
