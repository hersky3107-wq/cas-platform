/**
 * TECH category — closed catalogs. composeProposition reads ONLY these
 * ids. A hostile prompt can at worst produce a failed lookup key, never
 * a freeform object in the stored proposition.
 *
 * SCOPE (middle): product launches / announcements; specs and pricing;
 * corporate events (acquisitions, IPOs, executive departures).
 * NOT share price or earnings numbers — those ids are absent on purpose.
 */

export const TECH_CLAIM_KINDS = ['product_launch', 'spec_or_pricing', 'corporate_event'] as const
export type TechClaimKind = (typeof TECH_CLAIM_KINDS)[number]

export const TECH_VENUES = ['official_newsroom', 'investor_relations', 'product_site'] as const
export type TechVenueId = (typeof TECH_VENUES)[number]

export const TECH_ARTIFACTS = ['product_page', 'press_release', 'spec_sheet', 'pricing_page', 'form_8k'] as const
export type TechArtifactId = (typeof TECH_ARTIFACTS)[number]

/** Claim kinds the stocks chip owns. Present so we can refuse them by id. */
export const PRICE_OR_EARNINGS_CLAIM_KINDS = [
  'stock_price',
  'close_higher',
  'earnings',
  'eps',
  'revenue',
  'guidance',
] as const

export type TechCompany = {
  id: string
  label_en: string
  label_ko: string
  /** Official newsroom origin used in the resolution rule (not fetched). */
  newsroom: string
  synonyms: readonly string[]
}

export const TECH_COMPANIES: readonly TechCompany[] = [
  {
    id: 'AAPL',
    label_en: 'Apple',
    label_ko: '애플',
    newsroom: 'https://www.apple.com/newsroom/',
    synonyms: ['aapl', 'apple', '애플'],
  },
  {
    id: 'GOOG',
    label_en: 'Google',
    label_ko: '구글',
    newsroom: 'https://blog.google/',
    synonyms: ['goog', 'google', 'alphabet', '구글'],
  },
  {
    id: 'MSFT',
    label_en: 'Microsoft',
    label_ko: '마이크로소프트',
    newsroom: 'https://news.microsoft.com/',
    synonyms: ['msft', 'microsoft', '마이크로소프트'],
  },
  {
    id: 'NVDA',
    label_en: 'NVIDIA',
    label_ko: '엔비디아',
    newsroom: 'https://nvidianews.nvidia.com/',
    synonyms: ['nvda', 'nvidia', '엔비디아'],
  },
  {
    id: 'SAMSUNG',
    label_en: 'Samsung',
    label_ko: '삼성전자',
    newsroom: 'https://news.samsung.com/',
    synonyms: ['samsung', '삼성', '삼성전자'],
  },
  {
    id: 'META',
    label_en: 'Meta',
    label_ko: '메타',
    newsroom: 'https://about.fb.com/news/',
    synonyms: ['meta', 'facebook', '메타'],
  },
  {
    id: 'OPENAI',
    label_en: 'OpenAI',
    label_ko: '오픈AI',
    newsroom: 'https://openai.com/news/',
    synonyms: ['openai', '오픈ai', '오픈에이아이'],
  },
]

export type TechObject = {
  id: string
  companyId: string
  claimKind: TechClaimKind
  label_en: string
  label_ko: string
  defaultArtifact: TechArtifactId
  defaultVenue: TechVenueId
}

export const TECH_OBJECTS: readonly TechObject[] = [
  {
    id: 'foldable_iphone',
    companyId: 'AAPL',
    claimKind: 'product_launch',
    label_en: 'a foldable iPhone',
    label_ko: '폴더블 아이폰',
    defaultArtifact: 'product_page',
    defaultVenue: 'official_newsroom',
  },
  {
    id: 'vision_pro_2',
    companyId: 'AAPL',
    claimKind: 'product_launch',
    label_en: 'Vision Pro 2',
    label_ko: '비전 프로 2',
    defaultArtifact: 'product_page',
    defaultVenue: 'official_newsroom',
  },
  {
    id: 'galaxy_s26',
    companyId: 'SAMSUNG',
    claimKind: 'product_launch',
    label_en: 'Galaxy S26',
    label_ko: '갤럭시 S26',
    defaultArtifact: 'product_page',
    defaultVenue: 'official_newsroom',
  },
  {
    id: 'copilot_pc_hardware',
    companyId: 'MSFT',
    claimKind: 'product_launch',
    label_en: 'a Copilot+ PC reference design',
    label_ko: 'Copilot+ PC 레퍼런스 디자인',
    defaultArtifact: 'product_page',
    defaultVenue: 'official_newsroom',
  },
  {
    id: 'rubin_gpu',
    companyId: 'NVDA',
    claimKind: 'spec_or_pricing',
    label_en: 'the Rubin GPU',
    label_ko: 'Rubin GPU',
    defaultArtifact: 'pricing_page',
    defaultVenue: 'official_newsroom',
  },
  {
    id: 'gpt5_api_pricing',
    companyId: 'OPENAI',
    claimKind: 'spec_or_pricing',
    label_en: 'GPT-5 API pricing',
    label_ko: 'GPT-5 API 가격',
    defaultArtifact: 'pricing_page',
    defaultVenue: 'product_site',
  },
  {
    id: 'meta_cfo_departure',
    companyId: 'META',
    claimKind: 'corporate_event',
    label_en: 'a CFO departure',
    label_ko: 'CFO 퇴임',
    defaultArtifact: 'form_8k',
    defaultVenue: 'investor_relations',
  },
  {
    id: 'google_deepmind_acquisition',
    companyId: 'GOOG',
    claimKind: 'corporate_event',
    label_en: 'a named DeepMind-related acquisition',
    label_ko: '딥마인드 관련 인수',
    defaultArtifact: 'press_release',
    defaultVenue: 'official_newsroom',
  },
]

/**
 * Prior official-publication counts used as a BASE RATE when no live
 * numeric feed exists. These are catalog facts (last-12-month official
 * product-page / 8-K counts the operator last recorded), not live quotes.
 */
export type TechBaseRate = {
  officialPostsLast12m: number
  sameClassOfficialPostsLast12m: number
  asOf: string
}

export const TECH_BASE_RATES: Readonly<Record<string, TechBaseRate>> = {
  AAPL: { officialPostsLast12m: 14, sameClassOfficialPostsLast12m: 0, asOf: '2026-09-01' },
  GOOG: { officialPostsLast12m: 22, sameClassOfficialPostsLast12m: 1, asOf: '2026-09-01' },
  MSFT: { officialPostsLast12m: 18, sameClassOfficialPostsLast12m: 2, asOf: '2026-09-01' },
  NVDA: { officialPostsLast12m: 9, sameClassOfficialPostsLast12m: 3, asOf: '2026-09-01' },
  SAMSUNG: { officialPostsLast12m: 16, sameClassOfficialPostsLast12m: 4, asOf: '2026-09-01' },
  META: { officialPostsLast12m: 11, sameClassOfficialPostsLast12m: 1, asOf: '2026-09-01' },
  OPENAI: { officialPostsLast12m: 8, sameClassOfficialPostsLast12m: 2, asOf: '2026-09-01' },
}

export const TECH_RELATED: Readonly<Record<string, readonly { id: string; role: string }[]>> = {
  AAPL: [{ id: 'SAMSUNG', role: 'foldable peer' }],
  SAMSUNG: [{ id: 'AAPL', role: 'foldable peer' }],
  NVDA: [{ id: 'MSFT', role: 'largest disclosed customer' }],
  MSFT: [{ id: 'OPENAI', role: 'model partner' }],
  OPENAI: [{ id: 'MSFT', role: 'exclusive cloud partner' }],
  GOOG: [{ id: 'OPENAI', role: 'model competitor' }],
  META: [{ id: 'GOOG', role: 'ad-platform peer' }],
}

export const VENUE_LABEL: Record<TechVenueId, { en: string; ko: string }> = {
  official_newsroom: { en: 'official newsroom', ko: '공식 뉴스룸' },
  investor_relations: { en: 'investor-relations site', ko: '투자자 공시 사이트' },
  product_site: { en: 'official product site', ko: '공식 제품 사이트' },
}

export const ARTIFACT_LABEL: Record<TechArtifactId, { en: string; ko: string }> = {
  product_page: { en: 'product page', ko: '제품 페이지' },
  press_release: { en: 'press release', ko: '보도자료' },
  spec_sheet: { en: 'spec sheet', ko: '사양표' },
  pricing_page: { en: 'pricing page', ko: '가격 페이지' },
  form_8k: { en: 'Form 8-K', ko: 'Form 8-K' },
}

export const CLAIM_KIND_LABEL: Record<TechClaimKind, { en: string; ko: string }> = {
  product_launch: { en: 'product launch', ko: '제품 출시' },
  spec_or_pricing: { en: 'spec or pricing', ko: '사양·가격' },
  corporate_event: { en: 'corporate event', ko: '기업 이벤트' },
}

export function companyById(id: string): TechCompany | null {
  return TECH_COMPANIES.find((c) => c.id === id) ?? null
}

export function objectById(id: string): TechObject | null {
  return TECH_OBJECTS.find((o) => o.id === id) ?? null
}

export function isTechClaimKind(raw: string | null | undefined): raw is TechClaimKind {
  return !!raw && (TECH_CLAIM_KINDS as readonly string[]).includes(raw)
}

export function isTechVenue(raw: string | null | undefined): raw is TechVenueId {
  return !!raw && (TECH_VENUES as readonly string[]).includes(raw)
}

export function isTechArtifact(raw: string | null | undefined): raw is TechArtifactId {
  return !!raw && (TECH_ARTIFACTS as readonly string[]).includes(raw)
}

export function isPriceOrEarningsKind(raw: string | null | undefined): boolean {
  return !!raw && (PRICE_OR_EARNINGS_CLAIM_KINDS as readonly string[]).includes(raw)
}

export function resolveCompanyMention(raw: string): TechCompany | TechCompany[] | null {
  const needle = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (!needle) return null
  const exact = TECH_COMPANIES.find((c) => c.id.toLowerCase() === needle || c.synonyms.includes(needle))
  if (exact) return exact
  const prefix = TECH_COMPANIES.filter((c) =>
    c.synonyms.some((s) => s.startsWith(needle) && s !== needle),
  )
  if (prefix.length === 1) return prefix
  if (prefix.length > 1) return prefix
  return null
}

export function objectsFor(companyId: string, claimKind?: TechClaimKind | null): readonly TechObject[] {
  return TECH_OBJECTS.filter((o) => o.companyId === companyId && (!claimKind || o.claimKind === claimKind))
}

/** `TECH:{company}:{claimKind}:{object}` — the only instrument shape this adapter writes. */
export function encodeTechInstrument(companyId: string, claimKind: TechClaimKind, objectId: string): string {
  return `TECH:${companyId}:${claimKind}:${objectId}`
}

export function decodeTechInstrument(instrument: string): {
  companyId: string
  claimKind: TechClaimKind
  objectId: string
} | null {
  const parts = instrument.split(':')
  if (parts.length !== 4 || parts[0] !== 'TECH') return null
  const [, companyId, claimKind, objectId] = parts
  if (!companyById(companyId) || !isTechClaimKind(claimKind) || !objectById(objectId)) return null
  return { companyId, claimKind, objectId }
}
