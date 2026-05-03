import type { AiProviderName } from '@/lib/ai/router'
import { VERDICT_SCORE_AI_ORDER } from '@/lib/verdict-score'

export const VERDICT_FACTCHECK_AI_ORDER: AiProviderName[] = [...VERDICT_SCORE_AI_ORDER]

export type FactVerdict = 'true' | 'mostly_true' | 'misleading' | 'false' | 'uncertain'

export const FACT_VERDICT_ORDER: FactVerdict[] = [
  'true',
  'mostly_true',
  'misleading',
  'false',
  'uncertain',
]

export const FACT_VERDICT_DISPLAY: Record<
  FactVerdict,
  { icon: string; label: string; color: string }
> = {
  true: { icon: '✅', label: 'TRUE', color: '#22C55E' },
  mostly_true: { icon: '🟡', label: 'MOSTLY TRUE', color: '#EAB308' },
  misleading: { icon: '🟠', label: 'MISLEADING', color: '#F97316' },
  false: { icon: '❌', label: 'FALSE', color: '#EF4444' },
  uncertain: { icon: '❓', label: 'UNCERTAIN', color: '#6B7280' },
}

export function emptyFactVerdictCounts(): Record<FactVerdict, number> {
  return {
    true: 0,
    mostly_true: 0,
    misleading: 0,
    false: 0,
    uncertain: 0,
  }
}

export function buildVerdictFactcheckSystemPrompt(sourceUrlTrimmed: string): string {
  const sourceLead = sourceUrlTrimmed
    ? `The user may provide an optional source URL for context (verify the claim critically; the URL alone is not proof):\n${sourceUrlTrimmed}\n\n`
    : ''
  return (
    sourceLead +
    `You are a world-class fact-checker with deep expertise across all domains — ` +
    `science, politics, history, medicine, economics, culture, and regional affairs.\n` +
    `You fact-check with the rigor of Snopes, PolitiFact, and FullFact combined.\n\n` +
    `CRITICAL REQUIREMENTS:\n` +
    `- Investigate the claim with genuine depth and expertise\n` +
    `- Cite specific evidence, data, studies, or authoritative sources by name\n` +
    `- Consider regional and cultural context — if the claim is region-specific, ` +
    `apply locally relevant expertise and knowledge\n` +
    `- Never give vague or generic verdicts — be specific and precise\n` +
    `- Your reasoning must be at expert journalist + domain specialist level\n` +
    `- Expose subtle misleading framing, not just outright falsehoods\n\n` +
    `You MUST respond in EXACTLY this format:\n` +
    `VERDICT: [one of: TRUE / MOSTLY TRUE / MISLEADING / FALSE / UNCERTAIN]\n` +
    `EVIDENCE: [3-4 sentences of specific, expert-level evidence supporting your verdict. ` +
    `Name actual sources, studies, organizations, or data. ` +
    `Be precise — include numbers, dates, names where relevant.\n` +
    `Always respond in the same language as the input claim.]`
  )
}

export function stripMarkdownFormattingForFactcheck(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n')
  t = t.replace(/^#{1,6}\s+/gm, '')
  t = t.replace(/\*\*([^*]*)\*\*/g, '$1')
  t = t.replace(/__(.+?)__/g, '$1')
  t = t.replace(/\*(.+?)\*/g, '$1')
  t = t.replace(/_(.+?)_/g, '$1')
  t = t.replace(/^\s*[-*+]\s+/gm, '')
  t = t.replace(/\*\*/g, '')
  t = t.replace(/\*/g, '')
  t = t.replace(/^-\s*/gm, '')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

export function normalizeFactVerdictLine(raw: string): FactVerdict | null {
  const u = raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
  if (u === 'TRUE') return 'true'
  if (u === 'MOSTLY TRUE' || u === 'MOSTLYTRUE') return 'mostly_true'
  if (u === 'MISLEADING') return 'misleading'
  if (u === 'FALSE') return 'false'
  if (u === 'UNCERTAIN') return 'uncertain'
  return null
}

export function parseVerdictFactcheckResponse(text: string | null): {
  verdict: FactVerdict | null
  evidence: string
} {
  if (!text) return { verdict: null, evidence: '' }
  const vBlock = text.match(/VERDICT:\s*([^\n\r]+)/i)
  let verdict: FactVerdict | null = null
  if (vBlock) {
    verdict = normalizeFactVerdictLine(vBlock[1]!)
  }
  const eMatch = text.match(/EVIDENCE:\s*([\s\S]+)/i)
  const evidence = eMatch?.[1] != null ? eMatch[1].trim() : text.trim()
  return { verdict, evidence }
}

export function majorityFactVerdict(
  counts: Record<FactVerdict, number>
): { winner: FactVerdict | null; tie: boolean } {
  let max = 0
  for (const k of FACT_VERDICT_ORDER) {
    if (counts[k] > max) max = counts[k]
  }
  if (max === 0) return { winner: null, tie: true }
  const top = FACT_VERDICT_ORDER.filter((k) => counts[k] === max)
  if (top.length !== 1) return { winner: null, tie: true }
  return { winner: top[0]!, tie: false }
}
