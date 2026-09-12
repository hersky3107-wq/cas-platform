/**
 * Two-tier 용신 authority.
 *
 * TIER 1 — the engine produced a 용신: that 오행 is authoritative.
 * TIER 2 — 억부 판정불가 (종격/편왕): the AI must still say what the chart
 * needs, labelled as AI 판단. Never present that guess as 억부법 계산.
 */
import { elementKoHanja } from './display-copy'

export const YONGSIN_ELEMENTS = ['wood', 'fire', 'earth', 'metal', 'water'] as const
export type YongsinElement = (typeof YONGSIN_ELEMENTS)[number]

const HANJA_TO_ELEMENT: Record<string, YongsinElement> = {
  木: 'wood',
  火: 'fire',
  土: 'earth',
  金: 'metal',
  水: 'water',
}

const KO_TO_ELEMENT: Record<string, YongsinElement> = {
  목: 'wood',
  화: 'fire',
  토: 'earth',
  금: 'metal',
  수: 'water',
}

export const YONGSIN_SILENCE_PHRASES = [
  '용신을 하나로 고정하지 않습니다',
  '용신을 고정하지 않습니다',
  '용신을 억지로 고르지 않습니다',
] as const

export type YongsinChartState = {
  computed: YongsinElement | null
  inapplicable: boolean
  balanced: boolean
}

export type YongsinDefect = 'override' | 'silence' | 'balanced' | null

export type YongsinGuardResult = {
  /** Korean 화(火) stored on the reading when TIER 2 produced an 오행. */
  needed: string | null
  defect: YongsinDefect
}

export type YongsinInference = {
  brand: string
  element: string
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseFiveElement(value: string | null | undefined): YongsinElement | null {
  if (!value) return null
  const trimmed = value.trim()
  if ((YONGSIN_ELEMENTS as readonly string[]).includes(trimmed)) return trimmed as YongsinElement
  const wrapped = trimmed.match(/^([목화토금수])\s*\(([木火土金水])\)/)
  if (wrapped) return KO_TO_ELEMENT[wrapped[1]!] ?? HANJA_TO_ELEMENT[wrapped[2]!] ?? null
  if (KO_TO_ELEMENT[trimmed]) return KO_TO_ELEMENT[trimmed]!
  if (HANJA_TO_ELEMENT[trimmed]) return HANJA_TO_ELEMENT[trimmed]!
  const hanja = trimmed.match(/[木火土金水]/)
  if (hanja) return HANJA_TO_ELEMENT[hanja[0]!] ?? null
  const koChar = trimmed.match(/[목화토금수]/)
  if (koChar) return KO_TO_ELEMENT[koChar[0]!] ?? null
  return null
}

export function elementLabel(element: YongsinElement): string {
  return elementKoHanja(element)
}

export function formatComputedYongsinLine(element: string): string {
  return `용신 ${element} · 억부법 계산`
}

export function formatInferredYongsinLine(element: string): string {
  return `${element}가 필요해 보입니다 · AI 판단`
}

export function yongsinSilenceIn(narrative: string): boolean {
  return YONGSIN_SILENCE_PHRASES.some((phrase) => narrative.includes(phrase))
}

/** True when the prose names a 용신 오행 other than the computed one. */
export function yongsinNarrativeOverride(narrative: string, computed: YongsinElement): boolean {
  const match = narrative.match(/용신[^.\n]{0,16}(목|화|토|금|수|木|火|土|金|水)/)
  if (!match?.[1]) return false
  const named = parseFiveElement(match[1])
  return named != null && named !== computed
}

function yongsinBlockFromPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const kind = str(payload.kind)
  const systems = rec(payload.systems)
  if (kind === 'daily' || systems?.saju) {
    const saju = rec(systems?.saju)
    return rec(saju?.용신)
  }
  const chart = rec(payload.chart)
  if (!chart) return null
  if (kind === 'compat') {
    return rec(rec(chart.a)?.용신) ?? rec(rec(chart.b)?.용신)
  }
  return rec(chart.용신)
}

export function readYongsinChartState(payload: Record<string, unknown>): YongsinChartState | null {
  const block = yongsinBlockFromPayload(payload)
  if (!block) return null
  const inapplicable = str(block.판정불가) !== '' && str(block.판정불가) !== '없음'
  const 출처 = str(block.출처)
  const computed = parseFiveElement(str(block.용신) === '없음' ? '' : str(block.용신))
  const balanced = str(block.강약) === '중화'
  return {
    computed,
    inapplicable: inapplicable || 출처 === 'AI 판단 요청',
    balanced,
  }
}

export function applyYongsinGuard(opts: {
  state: YongsinChartState
  proposed: string | null | undefined
  narrative: string
}): YongsinGuardResult {
  const proposed = parseFiveElement(opts.proposed ?? null)

  if (opts.state.computed) {
    const narrativeClash = yongsinNarrativeOverride(opts.narrative, opts.state.computed)
    const fieldClash = proposed != null && proposed !== opts.state.computed
    return {
      needed: null,
      defect: narrativeClash || fieldClash ? 'override' : null,
    }
  }

  if (opts.state.balanced && !opts.state.inapplicable) {
    return { needed: null, defect: proposed != null ? 'balanced' : null }
  }

  if (!opts.state.inapplicable) {
    return { needed: null, defect: null }
  }

  if (proposed) return { needed: elementLabel(proposed), defect: null }
  return { needed: null, defect: 'silence' }
}

export function yongsinRetryInstruction(kind: Exclude<YongsinDefect, null>, computedLabel?: string): string {
  if (kind === 'override') {
    const label = computedLabel ?? 'the chart 용신'
    return `\n\nYONGSIN RETRY: The chart already has a computed 용신 (${label}). That value is TIER 1 — copy it. Do not name any other 오행 as 용신. Omit the JSON field "needed", or set it to the same 오행. Output ONLY the JSON object.`
  }
  if (kind === 'balanced') {
    return `\n\nYONGSIN RETRY: 강약 is 중화 — that is a computed TIER 1 result. Say the chart is balanced. Do not pick a 용신. Omit "needed". Output ONLY the JSON object.`
  }
  return `\n\nYONGSIN RETRY: 억부 판정불가 — you MUST still say what this 사주 needs and why, from 일간·득령/득지/득세·편왕·십신분포·대운. Fill "needed" with 목 or 화 or 토 or 금 or 수. Forbidden: "용신을 고정하지 않습니다" and similar refusals. Output ONLY the JSON object.`
}

export function inferencesFromReadingSummaries(
  readings: Array<{ brand: string; summary: Record<string, unknown> | null }>,
): YongsinInference[] {
  const rows: YongsinInference[] = []
  for (const reading of readings) {
    const needed = str(reading.summary?.needed)
    const element = parseFiveElement(needed)
    if (!element) continue
    rows.push({ brand: reading.brand, element: elementLabel(element) })
  }
  return rows
}

export function collapseYongsinInferences(rows: YongsinInference[]): Array<{ element: string; brand: string | null }> {
  if (rows.length === 0) return []
  const unique = new Set(rows.map((row) => row.element))
  if (unique.size === 1) return [{ element: rows[0]!.element, brand: null }]
  return rows.map((row) => ({ element: row.element, brand: row.brand }))
}
