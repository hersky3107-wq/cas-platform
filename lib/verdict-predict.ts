import type { AiProviderName } from '@/lib/ai/router'
import { VERDICT_SCORE_AI_ORDER } from '@/lib/verdict-score'

export const VERDICT_PREDICT_AI_ORDER: AiProviderName[] = [...VERDICT_SCORE_AI_ORDER]

export function buildVerdictPredictSystemPrompt(): string {
  return (
    `You are a precise forecasting expert. The user will give you a question ` +
    `or scenario to predict the probability of.\n\n` +
    `Respond in EXACTLY this format and nothing else:\n` +
    `PROBABILITY: [number between 0-100]%\n` +
    `REASONING: [2-3 sentences explaining your prediction with specific, ` +
    `expert-level reasoning. Reference relevant data, trends, or evidence. ` +
    `Be direct and decisive.]\n\n` +
    `Provide specific, expert-level reasoning — avoid generic or obvious statements.\n\n` +
    `Always respond in the same language as the input text.`
  )
}

export function stripMarkdownFormattingForPredict(raw: string): string {
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

export function parseVerdictPredictResponse(text: string | null): {
  probability: number | null
  reasoning: string
} {
  if (!text) return { probability: null, reasoning: '' }
  const probMatch = text.match(/PROBABILITY:\s*(\d+(?:\.\d+)?)\s*%?/i)
  let probability: number | null = null
  if (probMatch) {
    const n = parseFloat(probMatch[1]!)
    if (!Number.isNaN(n)) probability = Math.min(100, Math.max(0, Math.round(n * 100) / 100))
  }
  const reasonMatch = text.match(/REASONING:\s*([\s\S]+)/i)
  const reasoning = reasonMatch ? reasonMatch[1].trim() : text.trim()
  return { probability, reasoning }
}

/** Labels for 0–100 inclusive bands per spec. */
export function probabilityLabel(percent: number): string {
  const p = Math.round(percent)
  if (p <= 20) return 'Very Unlikely'
  if (p <= 40) return 'Unlikely'
  if (p <= 60) return 'Uncertain'
  if (p <= 80) return 'Likely'
  return 'Very Likely'
}

/**
 * Mean over every forecaster slot (length n); unparsed / null counts as 0
 * so all six AIs are included in the denominator with no outlier removal.
 */
export function averagePredictionsAllForecasters(probabilities: (number | null)[]): number | null {
  const n = probabilities.length
  if (n === 0) return null
  const sum = probabilities.reduce<number>(
    (acc, p) => acc + (p != null && !Number.isNaN(p) ? p : 0),
    0
  )
  return Math.round((sum / n) * 100) / 100
}
