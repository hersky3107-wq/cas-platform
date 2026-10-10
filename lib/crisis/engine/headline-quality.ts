import { consequenceOf } from '../outcomes/predictions'
import type { Draft } from './hunter-rules'
import type { Hypothesis } from './schema'

const VAGUE_HEADLINE =
  /\b(needs work|need work|needs seismic|responsibility is split|split responsibility|institutional gap|coordination gap|desks do not|offices do not)\b|내진 보강|책임 분산|기관 책임/i

const WHO =
  /\b(resident|residents|village|villages|downstream|neighbourhood|neighborhood|district|tap|taps|road|roads|clinic|hospital|camp|camps|settlement|intake|water cut|evacuation|people|households|drivers|commuters|well|wells|estate)\b|주민|마을|하류|도로|수돗물|이재민|대피/i

const WHAT_HAPPENS =
  /\b(spill|flood|cut|close|block|displace|evacuate|outbreak|contaminat|muddy|turbid|collapse|breach|overtop|wash|poison|sever|interrupt|cut off)\b|방류|범람|단수|차단|붕괴|오염|흙탕|대피/i

export function headlineVague(text: string): boolean {
  return VAGUE_HEADLINE.test(text)
}

/** A headline names a consequence and who it hits, not a gap or a to-do. */
export function headlineConcrete(text: string): boolean {
  if (headlineVague(text)) return false
  if (consequenceOf(text)) return WHO.test(text) || WHAT_HAPPENS.test(text)
  return WHO.test(text) && WHAT_HAPPENS.test(text)
}

export function structureScore(row: {
  entities?: string[]
  mechanism?: string
  early_indicators?: string[]
  falsifier?: string
  title?: string
}): number {
  let score = 0
  if ((row.entities ?? []).some((name) => name.trim().length >= 3)) score += 4
  if ((row.mechanism ?? '').trim().length >= 20) score += 3
  if ((row.early_indicators ?? []).some((line) => line.trim().length >= 8) || (row.falsifier ?? '').trim().length >= 8) score += 2
  if (headlineConcrete(row.title ?? '')) score += 2
  return score
}

export function headlineRankScore(row: { structure: number; non: number; stage: number }): number {
  return row.structure * 100 + row.stage * 10 + row.non
}

export function draftForHeadline(draft: Draft): { entities?: string[]; mechanism?: string; early_indicators?: string[]; falsifier?: string; title?: string } {
  return {
    entities: draft.entities,
    mechanism: draft.mechanism,
    early_indicators: draft.early_indicators,
    falsifier: draft.falsifier,
    title: draft.title,
  }
}

export function hypothesisForHeadline(row: Pick<Hypothesis, 'entities' | 'mechanism' | 'early_indicators' | 'falsifier' | 'title'>): {
  entities?: string[]
  mechanism?: string
  early_indicators?: string[]
  falsifier?: string
  title?: string
} {
  return row
}
