/**
 * Korean display names for the league reader pack and code fallback.
 * Engines stay English; copy comes from oracle display-copy.
 */
import {
  ELEMENT_KO,
  MONTH_PHASE_KO,
  RELATIVE_KO,
  RUNE_KO,
  RUNE_MEANING_KO,
  tarotCardNameKo,
} from '../display-copy'
import { TAROT_DECK } from '../engines/draw'
import type { FiveElement } from '../engines/calendar/types'
import type { SixRelative } from '../engines/draw/tables'
import type { MonthPhase } from '../engines/draw/types'

export function tarotNameKo(englishName: string, id?: number): string {
  const resolvedId = id ?? TAROT_DECK.find((card) => card.name === englishName)?.id
  if (typeof resolvedId === 'number') return tarotCardNameKo(englishName, resolvedId)
  return tarotCardNameKo(englishName, -1)
}

export function runeNameKo(englishName: string): string {
  return RUNE_KO[englishName] ?? englishName
}

export function runeMeaningKo(englishName: string): string {
  return RUNE_MEANING_KO[englishName] ?? '그 룬이 가리키는 자리'
}

export function relativeKo(relative: string): string {
  return RELATIVE_KO[relative] ?? relative
}

export function monthPhaseKo(phase: string | null): string | null {
  if (!phase) return null
  return MONTH_PHASE_KO[phase as MonthPhase] ?? phase
}

export function elementKo(element: string): string {
  return ELEMENT_KO[element] ?? element
}

/** 육친 as a topic-breath, not a log label. */
export const RELATIVE_SENSE: Record<SixRelative, string> = {
  官鬼: '승부와 권위의 기운',
  妻财: '재물과 이득의 기운',
  父母: '문서와 집의 기운',
  子孙: '결실과 풀림의 기운',
  兄弟: '겨루는 짝의 기운',
}

export const MONTH_PHASE_SENSE: Record<MonthPhase, string> = {
  旺: '한창 힘이 오른 자리',
  相: '옆에서 받쳐 주는 자리',
  休: '한숨 돌리는 자리',
  囚: '갇혀 기운이 막힌 자리',
  死: '힘이 빠져 있는 자리',
}

export const ELEMENT_SENSE: Record<FiveElement, string> = {
  wood: '목은 뻗어 나가는 기운',
  fire: '화는 밝히고 드러내는 기운',
  earth: '토는 받치고 모으는 기운',
  metal: '금은 가르고 다듬는 기운',
  water: '수는 흐르고 스며드는 기운',
}

export function relativeSense(relative: string): string {
  return RELATIVE_SENSE[relative as SixRelative] ?? '그 육친이 가리키는 기운'
}

export function monthPhaseSense(phase: string | null): string {
  if (!phase) return '월령을 읽지 못한 자리'
  return MONTH_PHASE_SENSE[phase as MonthPhase] ?? '그 월령의 자리'
}

export function elementSense(element: string): string {
  return ELEMENT_SENSE[element as FiveElement] ?? '그 오행의 기운'
}
