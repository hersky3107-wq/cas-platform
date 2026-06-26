/**
 * Centralized AI provider → PRODUCT name mapping for all Jeju UI.
 * Always show the product name (Claude, ChatGPT, Gemini…), never the company
 * name (anthropic, openai, google…). A small Korean gloss is available for
 * surfaces with room (roster, votes).
 */

const PRODUCT: Record<string, { name: string; gloss?: string }> = {
  anthropic: { name: 'Claude', gloss: '클로드' },
  openai: { name: 'ChatGPT', gloss: '챗지피티' },
  google: { name: 'Gemini', gloss: '제미나이' },
  xai: { name: 'Grok', gloss: '그록' },
  deepseek: { name: 'DeepSeek', gloss: '딥시크' },
  mistral: { name: 'Mistral', gloss: '미스트랄' },
  perplexity: { name: 'Perplexity', gloss: '퍼플렉시티' },
  meta: { name: 'Llama', gloss: '라마' },
}

/** Product name only, e.g. 'Claude'. Falls back to the raw key if unknown. */
export function aiProductName(provider?: string | null): string {
  if (!provider) return ''
  return PRODUCT[provider]?.name ?? provider
}

/** Product name + Korean gloss, e.g. 'Claude (클로드)'. */
export function aiProductNameWithGloss(provider?: string | null): string {
  if (!provider) return ''
  const p = PRODUCT[provider]
  if (!p) return provider
  return p.gloss ? `${p.name} (${p.gloss})` : p.name
}
