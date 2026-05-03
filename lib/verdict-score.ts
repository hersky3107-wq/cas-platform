import type { AiProviderName } from '@/lib/ai/router'

export const VERDICT_SCORE_AI_ORDER: AiProviderName[] = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'mistral',
]

export function buildVerdictScoreSystemPrompt(criteriaTrimmed: string): string {
  const c = criteriaTrimmed.trim()
  if (c) {
    return (
      `You are a strict, professional judge. Score the given content based on this specific criteria: ${c}\n\n` +
      `You MUST respond in EXACTLY this format and nothing else:\n` +
      `SCORE: [number between 0-100]\n` +
      `REVIEW: [3-4 sentences explaining your score with specific reasoning. Be direct, critical, and expert-level. No generic praise.]\n\n` +
      `Provide specific, expert-level reasoning — avoid generic or obvious statements.\n\n` +
      `Always respond in the same language as the input text.`
    )
  }
  return (
    `You are a strict, professional judge. Evaluate the given content comprehensively across all relevant dimensions (quality, clarity, originality, execution, etc.).\n\n` +
    `You MUST respond in EXACTLY this format and nothing else:\n` +
    `SCORE: [number between 0-100]\n` +
    `REVIEW: [3-4 sentences explaining your score with specific reasoning. Be direct, critical, and expert-level. No generic praise.]\n\n` +
    `Provide specific, expert-level reasoning — avoid generic or obvious statements.\n\n` +
    `Always respond in the same language as the input text.`
  )
}

export function parseVerdictScoreResponse(text: string | null): {
  score: number | null
  review: string
} {
  if (!text) return { score: null, review: '' }
  const scoreMatch = text.match(/SCORE:\s*(\d+)/i)
  const reviewMatch = text.match(/REVIEW:\s*([\s\S]+)/i)
  let score: number | null = null
  if (scoreMatch) {
    const n = parseInt(scoreMatch[1], 10)
    if (!Number.isNaN(n)) score = Math.min(100, Math.max(0, n))
  }
  const review = reviewMatch ? reviewMatch[1].trim() : text.trim()
  return { score, review }
}

export type OlympicOutcome = {
  average: number | null
  highestProvider: AiProviderName | null
  lowestProvider: AiProviderName | null
}

/** Remove one highest and one lowest (by stable AI order tie-break); average the rest. */
export function computeOlympicTrim(
  judges: { provider: AiProviderName; score: number | null }[],
  order: readonly AiProviderName[] = VERDICT_SCORE_AI_ORDER
): OlympicOutcome {
  const valid = judges.filter((j): j is { provider: AiProviderName; score: number } => j.score != null)
  if (valid.length === 0) return { average: null, highestProvider: null, lowestProvider: null }
  if (valid.length <= 2) {
    const sum = valid.reduce((s, j) => s + j.score, 0)
    return { average: sum / valid.length, highestProvider: null, lowestProvider: null }
  }

  const maxScore = Math.max(...valid.map((j) => j.score))
  const minScore = Math.min(...valid.map((j) => j.score))

  let highestProvider: AiProviderName | null = null
  let lowestProvider: AiProviderName | null = null
  for (const p of order) {
    const j = valid.find((v) => v.provider === p && v.score === maxScore)
    if (j) {
      highestProvider = p
      break
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const p = order[i]!
    const j = valid.find((v) => v.provider === p && v.score === minScore)
    if (j) {
      lowestProvider = p
      break
    }
  }

  if (!highestProvider || !lowestProvider || highestProvider === lowestProvider) {
    const sum = valid.reduce((s, j) => s + j.score, 0)
    return { average: sum / valid.length, highestProvider: null, lowestProvider: null }
  }

  const remaining = valid.filter(
    (j) => j.provider !== highestProvider && j.provider !== lowestProvider
  )
  if (remaining.length === 0) {
    const sum = valid.reduce((s, j) => s + j.score, 0)
    return { average: sum / valid.length, highestProvider, lowestProvider }
  }
  const sum = remaining.reduce((s, j) => s + j.score, 0)
  return {
    average: sum / remaining.length,
    highestProvider,
    lowestProvider,
  }
}
