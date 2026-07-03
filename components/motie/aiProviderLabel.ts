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

/**
 * The canonical display label, format "개발사 영문 (제품 한글)".
 * meta is intentionally product-name-first — "Llama (메타)".
 */
const LABEL: Record<string, string> = {
  openai: 'OpenAI (챗지피티)',
  anthropic: 'Anthropic (클로드)',
  google: 'Google (제미나이)',
  xai: 'xAI (그록)',
  deepseek: 'DeepSeek (딥시크)',
  mistral: 'Mistral (미스트랄)',
  meta: 'Llama (메타)',
  perplexity: 'Perplexity (퍼플렉시티)',
}

/**
 * Brand names (as stored on debate turns, e.g. "ChatGPT") → provider key, so the
 * label helpers accept BOTH a provider key ('openai') and a brand name ('ChatGPT').
 */
const BRAND_ALIAS: Record<string, string> = {
  ChatGPT: 'openai',
  Claude: 'anthropic',
  Gemini: 'google',
  Grok: 'xai',
  DeepSeek: 'deepseek',
  Mistral: 'mistral',
  Llama: 'meta',
  Perplexity: 'perplexity',
}

function normalize(provider: string): string {
  return BRAND_ALIAS[provider] ?? provider
}

/** Product name only, e.g. 'Claude'. Falls back to the raw key if unknown. */
export function aiProductName(provider?: string | null): string {
  if (!provider) return ''
  return PRODUCT[normalize(provider)]?.name ?? provider
}

/**
 * The canonical full label, e.g. 'OpenAI (챗지피티)'. Accepts a provider key or a
 * brand name. Used everywhere a participant is shown (roster, debate turns, vote).
 */
export function aiProductNameWithGloss(provider?: string | null): string {
  if (!provider) return ''
  const key = normalize(provider)
  if (LABEL[key]) return LABEL[key]
  const p = PRODUCT[key]
  if (!p) return provider
  return p.gloss ? `${p.name} (${p.gloss})` : p.name
}
