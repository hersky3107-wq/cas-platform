import { type Camp } from './card-types'

/** Home-country chip on a model tile. `INT` is the residual fallback, not a nation. */
export type CountryCode = 'US' | 'CN' | 'KR' | 'FR' | 'CA' | 'INT'

/** Roster brand → home country. Unknown brands fall back to the camp axis. */
const BRAND_COUNTRY: Record<string, CountryCode> = {
  OpenAI: 'US',
  Anthropic: 'US',
  Google: 'US',
  xAI: 'US',
  Meta: 'US',
  'Meta Muse': 'US',
  NVIDIA: 'US',
  Amazon: 'US',
  Microsoft: 'US',
  Perplexity: 'US',
  'You.com': 'US',
  Qwen: 'CN',
  DeepSeek: 'CN',
  'Moonshot AI': 'CN',
  'Z.ai': 'CN',
  MiniMax: 'CN',
  Xiaomi: 'CN',
  Baidu: 'CN',
  ByteDance: 'CN',
  Upstage: 'KR',
  NAVER: 'KR',
  LG: 'KR',
  Mistral: 'FR',
  Cohere: 'CA',
}

const CAMP_FALLBACK: Record<Camp, CountryCode> = { us: 'US', china: 'CN', other: 'INT' }

export const COUNTRY_NAME: Record<CountryCode, string> = {
  US: 'United States',
  CN: 'China',
  KR: 'South Korea',
  FR: 'France',
  CA: 'Canada',
  INT: 'International',
}

export const FLAG_SRC: Record<CountryCode, string> = {
  US: '/league/flags/us.svg',
  CN: '/league/flags/cn.svg',
  KR: '/league/flags/kr.svg',
  FR: '/league/flags/fr.svg',
  CA: '/league/flags/ca.svg',
  INT: '/league/flags/int.svg',
}

export function brandCountry(brand: string, camp: Camp): CountryCode {
  const baseBrand = brand.includes(' (') ? brand.slice(0, brand.indexOf(' (')) : brand
  return BRAND_COUNTRY[baseBrand] ?? CAMP_FALLBACK[camp]
}
