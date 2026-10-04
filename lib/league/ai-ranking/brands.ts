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
  'Baidu',
  'StepFun',
  'Meituan',
  'Ant Group',
  'IBM',
  'AllenAI',
  'Thinking Machines',
  'Black Forest Labs',
  'Ideogram',
  'Recraft',
  'Leonardo',
  'Krea',
  'HiDream',
  'Reve',
  'Sber (Kandinsky)',
  'Runway',
  'Pika',
  'Luma',
  'Kuaishou (Kling)',
  'Genmo',
  'Perplexity',
  'Poolside',
  'Diffbot',
  'Inception',
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
  baidu: 'Baidu',
  stepfun: 'StepFun',
  'step fun': 'StepFun',
  meituan: 'Meituan',
  'ant group': 'Ant Group',
  'ant-group': 'Ant Group',
  antgroup: 'Ant Group',
  ibm: 'IBM',
  allenai: 'AllenAI',
  ai2: 'AllenAI',
  'allen ai': 'AllenAI',
  'allenai/uw': 'AllenAI',
  'allenai uw': 'AllenAI',
  thinky: 'Thinking Machines',
  'thinking machines': 'Thinking Machines',
  thinkingmachines: 'Thinking Machines',
  bfl: 'Black Forest Labs',
  'black forest labs': 'Black Forest Labs',
  'black forest': 'Black Forest Labs',
  flux: 'Black Forest Labs',
  ideogram: 'Ideogram',
  recraft: 'Recraft',
  'leonardo-ai': 'Leonardo',
  'leonardo ai': 'Leonardo',
  leonardo: 'Leonardo',
  krea: 'Krea',
  hidream: 'HiDream',
  'hi dream': 'HiDream',
  reve: 'Reve',
  kandinsky: 'Sber (Kandinsky)',
  sber: 'Sber (Kandinsky)',
  runway: 'Runway',
  'runway ml': 'Runway',
  pika: 'Pika',
  'pika labs': 'Pika',
  'luma-ai': 'Luma',
  'luma ai': 'Luma',
  luma: 'Luma',
  kling: 'Kuaishou (Kling)',
  kuaishou: 'Kuaishou (Kling)',
  genmo: 'Genmo',
  wan: 'Alibaba/Qwen',
  perplexity: 'Perplexity',
  poolside: 'Poolside',
  diffbot: 'Diffbot',
  'inception-ai': 'Inception',
  'inception ai': 'Inception',
  inception: 'Inception',
  chatgpt: 'OpenAI',
  'chat gpt': 'OpenAI',
  gpt: 'OpenAI',
  '챗gpt': 'OpenAI',
  챗지피티: 'OpenAI',
  '오픈ai': 'OpenAI',
  오픈에이아이: 'OpenAI',
  클로드: 'Anthropic',
  claude: 'Anthropic',
  앤트로픽: 'Anthropic',
  제미나이: 'Google',
  gemini: 'Google',
  구글: 'Google',
  그록: 'xAI',
  grok: 'xAI',
  딥시크: 'DeepSeek',
  큐웬: 'Alibaba/Qwen',
  알리바바: 'Alibaba/Qwen',
  키미: 'Moonshot',
  kimi: 'Moonshot',
  문샷: 'Moonshot',
  glm: 'Zhipu/GLM',
  지푸: 'Zhipu/GLM',
  미니맥스: 'MiniMax',
  라마: 'Meta',
  llama: 'Meta',
  메타: 'Meta',
  뮤즈: 'Meta',
  muse: 'Meta',
  미스트랄: 'Mistral',
  플럭스: 'Black Forest Labs',
  블랙포레스트: 'Black Forest Labs',
  '블랙 포레스트': 'Black Forest Labs',
  런웨이: 'Runway',
  클링: 'Kuaishou (Kling)',
  루마: 'Luma',
  피카: 'Pika',
  아이디오그램: 'Ideogram',
  리크래프트: 'Recraft',
  엔비디아: 'NVIDIA',
  마이크로소프트: 'Microsoft',
  아마존: 'Amazon',
}

export const AIRANK_CAMPS = ['us', 'china', 'europe'] as const
export type AirankCamp = (typeof AIRANK_CAMPS)[number]
export type AirankCampOrOther = AirankCamp | 'other'

const BRAND_CAMP: Record<AiVendorBrand, AirankCampOrOther> = {
  OpenAI: 'us',
  Google: 'us',
  Anthropic: 'us',
  xAI: 'us',
  Meta: 'us',
  Microsoft: 'us',
  Amazon: 'us',
  NVIDIA: 'us',
  IBM: 'us',
  AllenAI: 'us',
  'Thinking Machines': 'us',
  Ideogram: 'us',
  Runway: 'us',
  Pika: 'us',
  Luma: 'us',
  Perplexity: 'us',
  Poolside: 'us',
  Diffbot: 'us',
  Inception: 'us',
  Krea: 'us',
  Genmo: 'us',
  DeepSeek: 'china',
  'Alibaba/Qwen': 'china',
  Moonshot: 'china',
  'Zhipu/GLM': 'china',
  MiniMax: 'china',
  ByteDance: 'china',
  Tencent: 'china',
  Baidu: 'china',
  Xiaomi: 'china',
  StepFun: 'china',
  Meituan: 'china',
  'Ant Group': 'china',
  'Kuaishou (Kling)': 'china',
  'Black Forest Labs': 'europe',
  Mistral: 'europe',
  Recraft: 'europe',
  Cohere: 'other',
  Upstage: 'other',
  NAVER: 'other',
  Leonardo: 'other',
  HiDream: 'other',
  Reve: 'other',
  'Sber (Kandinsky)': 'other',
}

export const AIRANK_CAMP_OTHER_BRANDS: readonly AiVendorBrand[] = AI_VENDOR_BRANDS.filter(
  (brand) => BRAND_CAMP[brand] === 'other',
)

export function isAirankCamp(value: string): value is AirankCamp {
  return (AIRANK_CAMPS as readonly string[]).includes(value)
}

export function campOfBrand(brand: MappedVendorBrand): AirankCampOrOther {
  if (brand === OTHER_VENDOR_BRAND) return 'other'
  return BRAND_CAMP[brand]
}

export function brandsInCamp(camp: AirankCamp): AiVendorBrand[] {
  return AI_VENDOR_BRANDS.filter((brand) => BRAND_CAMP[brand] === camp)
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
 * Model-name fallback. Used when organization is empty OR the organization
 * string is not in the closed alias list (so gpt-6* under an odd org still
 * maps to OpenAI). Unknown org + unknown model stays 기타.
 */
export function brandFromModelName(model: string): AiVendorBrand | null {
  const key = fold(model)
  if (!key) return null
  if (
    /^(gpt|chatgpt|o1|o3|o4)\b/.test(key) ||
    key.includes('chatgpt') ||
    /(^| )gpt[- ]?\d/.test(key)
  ) {
    return 'OpenAI'
  }
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
  if (
    key.includes('mistral') ||
    key.includes('mixtral') ||
    key.includes('magistral') ||
    key.includes('ministral') ||
    key.includes('codestral')
  ) {
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
  if (key.includes('ernie')) return 'Baidu'
  if (key.includes('step-') || key.startsWith('step ')) return 'StepFun'
  if (key.includes('longcat')) return 'Meituan'
  if (key.includes('inkling')) return 'Thinking Machines'
  if (/(^|[\s_-])(ling|ring)[-_]/.test(key)) return 'Ant Group'
  if (key.includes('granite')) return 'IBM'
  if (key.includes('olmo') || key.includes('tulu')) return 'AllenAI'
  if (key.includes('flux')) return 'Black Forest Labs'
  if (key.includes('ideogram')) return 'Ideogram'
  if (key.includes('recraft')) return 'Recraft'
  if (key.includes('leonardo')) return 'Leonardo'
  if (key.includes('krea')) return 'Krea'
  if (key.includes('hidream')) return 'HiDream'
  if (/\breve\b/.test(key)) return 'Reve'
  if (key.includes('kandinsky')) return 'Sber (Kandinsky)'
  if (key.includes('runway')) return 'Runway'
  if (/\bpika\b/.test(key)) return 'Pika'
  if (key.includes('luma') || key.includes('dream machine')) return 'Luma'
  if (key.includes('kling')) return 'Kuaishou (Kling)'
  if (key.includes('genmo') || key.includes('mochi')) return 'Genmo'
  if (/^wan[-_\s]/.test(key) || key.includes('wanxiang')) return 'Alibaba/Qwen'
  if (key.includes('sonar') || key.includes('perplexity')) return 'Perplexity'
  if (key.includes('poolside')) return 'Poolside'
  if (key.includes('diffbot')) return 'Diffbot'
  if (key.includes('mercury') || key.includes('inception')) return 'Inception'
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
  const fromModel = brandFromModelName(model)
  const org = organization?.trim() ?? ''
  if (fromModel) return { brand: fromModel, unmappedOrganization: org || null }
  if (org) return { brand: OTHER_VENDOR_BRAND, unmappedOrganization: org }
  return { brand: OTHER_VENDOR_BRAND, unmappedOrganization: null }
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
