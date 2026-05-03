import type { AiProviderName } from '@/lib/ai/router'
import { VERDICT_SCORE_AI_ORDER } from '@/lib/verdict-score'

export const VERDICT_VOTE_AI_ORDER: AiProviderName[] = [...VERDICT_SCORE_AI_ORDER]

export type VerdictVote = 'yes' | 'no' | null

export function buildVerdictVoteSystemPrompt(): string {
  return (
    `You are a decisive judge. The user will ask you a yes/no question ` +
    `or present a statement for you to agree/disagree with.\n\n` +
    `You MUST respond in EXACTLY this format:\n` +
    `VERDICT: YES or VERDICT: NO\n` +
    `REASON: [2-3 sentences explaining your verdict with specific, ` +
    `expert-level reasoning. Be direct and decisive. No hedging.]\n\n` +
    `Provide specific, expert-level reasoning — avoid generic or obvious statements.\n\n` +
    `Always respond in the same language as the input text.`
  )
}

export function stripMarkdownFormattingForVote(raw: string): string {
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

export function parseVerdictVoteResponse(text: string | null): {
  verdict: VerdictVote
  reason: string
} {
  if (!text) return { verdict: null, reason: '' }
  const vMatch = text.match(/VERDICT:\s*(YES|NO)\b/i)
  let verdict: VerdictVote = null
  if (vMatch) {
    const u = vMatch[1]!.toUpperCase()
    verdict = u === 'YES' ? 'yes' : u === 'NO' ? 'no' : null
  }
  const rMatch = text.match(/REASON:\s*([\s\S]+)/i)
  const reason = rMatch ? rMatch[1].trim() : text.trim()
  return { verdict, reason }
}

export const AI_PROVIDER_LABEL: Record<AiProviderName, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
}
