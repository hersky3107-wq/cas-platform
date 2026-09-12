import { LAYER1_INFERRED_MAX } from './ai/parse-layer1'

/**
 * TIER 2 on-screen labels.
 *
 * Compute whatever CAN be computed and treat it as authoritative (TIER 1).
 * Where the tradition has no codified rule but the chart has material, the AI
 * reasons and the UI marks that output as AI 판단. Only where there is no
 * material at all does the system stay silent.
 */

export type TextInference = {
  brand: string
  text: string
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function formatAiJudgementLine(text: string): string {
  return `${text} · AI 판단`
}

export function formatAiJudgementPending(detail: string): string {
  return `${detail} · AI 판단 요청`
}

export function clipInferred(value: string | null | undefined): string | null {
  const trimmed = str(value)
  if (!trimmed) return null
  return [...trimmed].slice(0, LAYER1_INFERRED_MAX).join('')
}

export function inferredFromReadingSummaries(
  readings: Array<{ brand: string; summary: Record<string, unknown> | null }>,
): TextInference[] {
  const rows: TextInference[] = []
  for (const reading of readings) {
    const text = clipInferred(str(rec(reading.summary)?.inferred))
    if (!text) continue
    rows.push({ brand: reading.brand, text })
  }
  return rows
}

export function collapseTextInferences(rows: TextInference[]): Array<{ text: string; brand: string | null }> {
  if (rows.length === 0) return []
  const unique = new Set(rows.map((row) => row.text))
  if (unique.size === 1) return [{ text: rows[0]!.text, brand: null }]
  return rows.map((row) => ({ text: row.text, brand: row.brand }))
}
