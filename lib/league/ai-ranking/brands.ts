/**
 * Vendor brands for AI 순위. Organization / model strings map onto this
 * closed list. Anything else is "기타" — unknown organizations are reported,
 * not guessed.
 */

import { LEAGUE_ROSTER, type RosterEntry } from '@/lib/league/roster'

export const AI_VENDOR_BRANDS = [
  'OpenAI',
  'Google',
  'Anthropic',
  'xAI',
  'Meta',
  'DeepSeek',
  'Alibaba/Qwen',
  'Moonshot',
  'Zhipu/GLM',
  'MiniMax',
  'Mistral',
  'Microsoft',
  'NVIDIA',
  'Amazon',
  'Tencent',
  'ByteDance',
  'Xiaomi',
  'Cohere',
  'Upstage',
  'NAVER',
] as const

export type AiVendorBrand = (typeof AI_VENDOR_BRANDS)[number]
export const OTHER_VENDOR_BRAND = '기타' as const
export type MappedVendorBrand = AiVendorBrand | typeof OTHER_VENDOR_BRAND

const ORG_ALIASES: Record<string, AiVendorBrand> = {
  openai: 'OpenAI',
  google: 'Google',
  anthropic: 'Anthropic',
  xai: 'xAI',
  meta: 'Meta',
  'meta muse': 'Meta',
  metamuse: 'Meta',
  deepseek: 'DeepSeek',
  alibaba: 'Alibaba/Qwen',
  qwen: 'Alibaba/Qwen',
  'alibaba cloud': 'Alibaba/Qwen',
  moonshot: 'Moonshot',
  'moonshot ai': 'Moonshot',
  moonshotai: 'Moonshot',
  zai: 'Zhipu/GLM',
  'z.ai': 'Zhipu/GLM',
  'z ai': 'Zhipu/GLM',
  zhipu: 'Zhipu/GLM',
  'zhipu ai': 'Zhipu/GLM',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  microsoft: 'Microsoft',
  'microsoft-ai': 'Microsoft',
  nvidia: 'NVIDIA',
  amazon: 'Amazon',
  tencent: 'Tencent',
  bytedance: 'ByteDance',
  xiaomi: 'Xiaomi',
  cohere: 'Cohere',
  upstage: 'Upstage',
  'upstage ai': 'Upstage',
  naver: 'NAVER',
}

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/[_./]+/g, ' ').replace(/\s+/g, ' ')
}

export function normalizeOrgKey(organization: string): string {
  return fold(organization)
}

export function brandFromOrganization(organization: string | null | undefined): AiVendorBrand | null {
  if (!organization) return null
  const key = fold(organization)
  return ORG_ALIASES[key] ?? null
}

/**
 * Model-name fallback used only when organization is empty. Do not apply this
 * to an unknown organization — those stay 기타 and are listed in the ingest
 * report.
 */
export function brandFromModelName(model: string): AiVendorBrand | null {
  const key = fold(model)
  if (!key) return null
  if (/^(gpt|chatgpt|o1|o3|o4)\b/.test(key) || key.includes('chatgpt')) return 'OpenAI'
  if (key.includes('claude')) return 'Anthropic'
  if (key.includes('gemini') || key.includes('gemma') || key.includes('palm')) return 'Google'
  if (key.includes('grok')) return 'xAI'
  if (key.includes('llama') || key.includes('muse spark') || key.startsWith('muse-') || key.startsWith('muse ')) {
    return 'Meta'
  }
  if (key.includes('deepseek')) return 'DeepSeek'
  if (key.includes('qwen') || key.includes('qwq') || key.includes('qianwen')) return 'Alibaba/Qwen'
  if (key.includes('kimi')) return 'Moonshot'
  if (key.includes('glm') || key.includes('chatglm')) return 'Zhipu/GLM'
  if (key.includes('minimax')) return 'MiniMax'
  if (key.includes('mistral') || key.includes('mixtral') || key.includes('magistral') || key.includes('ministral')) {
    return 'Mistral'
  }
  if (key.includes('phi-') || key.startsWith('phi ')) return 'Microsoft'
  if (key.includes('nemotron')) return 'NVIDIA'
  if (key.includes('nova')) return 'Amazon'
  if (key.includes('hunyuan') || /(^| )hy\d/.test(key)) return 'Tencent'
  if (key.includes('seed') && (key.includes('bytedance') || key.includes('dola') || /^seed/.test(key))) {
    return 'ByteDance'
  }
  if (key.includes('mimo')) return 'Xiaomi'
  if (key.includes('command')) return 'Cohere'
  if (key.includes('solar')) return 'Upstage'
  if (key.includes('hyperclova') || key.includes('hcx') || key.includes('clova')) return 'NAVER'
  return null
}

export type BrandMapping = {
  brand: MappedVendorBrand
  /** Non-empty organization that did not match the closed alias list. */
  unmappedOrganization: string | null
}

export function mapVendorBrand(organization: string | null | undefined, model: string): BrandMapping {
  const fromOrg = brandFromOrganization(organization)
  if (fromOrg) return { brand: fromOrg, unmappedOrganization: null }
  const org = organization?.trim() ?? ''
  if (org) return { brand: OTHER_VENDOR_BRAND, unmappedOrganization: org }
  return { brand: brandFromModelName(model) ?? OTHER_VENDOR_BRAND, unmappedOrganization: null }
}

export type RosterSeatVendor = {
  model_id: string
  rosterBrand: string
  vendorBrand: MappedVendorBrand
}

/** Official 40 seats → ranking vendor brand (for later self-vendor analysis). */
export function rosterSeatVendor(entry: Pick<RosterEntry, 'model_id' | 'brand'>): RosterSeatVendor {
  return {
    model_id: entry.model_id,
    rosterBrand: entry.brand,
    vendorBrand: mapVendorBrand(entry.brand, entry.model_id).brand,
  }
}

export function leagueRosterVendorBrands(roster: readonly Pick<RosterEntry, 'model_id' | 'brand'>[] = LEAGUE_ROSTER): RosterSeatVendor[] {
  return roster.map(rosterSeatVendor)
}
