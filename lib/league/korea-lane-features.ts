/**
 * Korean-lane product gates. Classification is ALWAYS `admissionStockLane`
 * (declared KR nationality OR KR IP) — do not invent a second classifier.
 *
 * Catalog has no `isEtf` field. ETF identity is the explicit symbol list
 * taken from `lib/league/catalog.ts` (index_etf chips, gold/silver ETFs,
 * commodities_energy ETF chips).
 */
import { admissionStockLane } from './stock-lane'
import { decodeStockInstrument } from './gateway/adapters/stock-catalog'
import type { JurisdictionInput } from './jurisdiction/resolve'

export type KrDeepPolicy = 'hide' | 'allow'

type LaneViewer = {
  isAdmin?: boolean
  jurisdiction: JurisdictionInput
}

/** `hide` = no 개방형 분석 / 찬반 토론 for Korean-lane viewers. */
const KR_DEEP_CATEGORY_TABLE: Record<string, KrDeepPolicy> = {
  stock: 'hide',
  stocks: 'hide',
  etf_index: 'hide',
  index_etf: 'hide',
  memecoin: 'hide',
  fx: 'hide',
  gold_metal: 'hide',
  gold_metals: 'hide',
  commodity_energy: 'hide',
  commodities_energy: 'hide',
  // pending product meeting after KR stocks
  macro_econ: 'hide',
  macro: 'hide',
  ai_models: 'allow',

  crypto: 'allow',
  crypto_spot: 'allow',
  crypto_perps: 'allow',
  sports: 'allow',
  politics_election: 'allow',
  entertainment: 'allow',
  entertainment_awards: 'allow',
  real_estate: 'allow',
  // category not built yet
  tech: 'allow',
}

/** All index_etf chips in catalog.ts. */
const INDEX_ETF_SYMBOLS = new Set([
  'SPY',
  'QQQ',
  'DIA',
  'EWJ',
  'EWY',
  'FEZ',
  'EWT',
  'TQQQ',
  'SQQQ',
  'SOXL',
  'UPRO',
  'SPXU',
  'VNQ',
  'SCHH',
])

/** Gold/silver ETFs in gold_metals (catalog.ts). Spots are XAU/XAG/XPT. */
const GOLD_ETF_SYMBOLS = new Set(['GLD', 'SLV'])

const GOLD_SPOT_SYMBOLS = new Set(['XAU/USD', 'XAG/USD', 'XPT/USD'])

/** ETF chips in commodities_energy (catalog.ts). */
const COMMODITY_ETF_SYMBOLS = new Set(['UNG', 'CPER', 'CORN', 'WEAT', 'SOYB', 'COFF'])

const COMMODITY_SPOT_SYMBOLS = new Set(['WTI/USD', 'XBR/USD'])

const ETF_SYMBOLS = new Set([...INDEX_ETF_SYMBOLS, ...GOLD_ETF_SYMBOLS, ...COMMODITY_ETF_SYMBOLS])

const unknownLogged = new Set<string>()

function logUnknownOnce(category: string, instrument: string): void {
  const key = `${category}|${instrument}`
  if (unknownLogged.has(key)) return
  unknownLogged.add(key)
  console.warn('[league/kr-deep] unknown category/instrument; fail-closed hide', { category, instrument })
}

function isStockInstrument(instrument: string): boolean {
  const raw = instrument.trim()
  if (!raw) return false
  if (raw.startsWith('STOCK:') || raw.startsWith('KRSTOCK:')) return true
  return decodeStockInstrument(raw) !== null
}

function isEtfSymbol(instrument: string): boolean {
  return ETF_SYMBOLS.has(instrument.trim().toUpperCase())
}

function isHiddenCommodityOrMetalSpot(instrument: string): boolean {
  const key = instrument.trim().toUpperCase()
  return GOLD_SPOT_SYMBOLS.has(key) || COMMODITY_SPOT_SYMBOLS.has(key)
}

/**
 * Per-instrument deep/debate policy. World-lane callers never consult this;
 * Korean-lane viewers hide when this returns `"hide"`.
 */
export function krDeepPolicyForInstrument(
  category: string | null | undefined,
  instrument: string | null | undefined,
): KrDeepPolicy {
  const cat = (category ?? '').trim()
  const inst = (instrument ?? '').trim()

  if (isStockInstrument(inst) || cat === 'stock' || cat === 'stocks') return 'hide'
  if (isEtfSymbol(inst) || cat === 'etf_index' || cat === 'index_etf') return 'hide'
  if (isHiddenCommodityOrMetalSpot(inst)) return 'hide'

  const row = cat ? KR_DEEP_CATEGORY_TABLE[cat] : undefined
  if (row === 'allow') return 'allow'
  if (row === 'hide') return 'hide'

  logUnknownOnce(cat || '(empty)', inst || '(empty)')
  return 'hide'
}

/**
 * UI + policy: Korean-lane viewer and an instrument whose policy is hide.
 * Admin is NOT exempt here (the hub still hides the buttons).
 * The API layer additionally requires `!viewer.isAdmin` before 403.
 */
export function isDeepDisabledForViewer(
  viewer: LaneViewer,
  category: string | null | undefined,
  instrument?: string | null,
): boolean {
  if (admissionStockLane(viewer.jurisdiction) !== 'korea') return false
  return krDeepPolicyForInstrument(category, instrument) === 'hide'
}

/** Non-admin Korean-lane viewers are blocked from deep-open / deep-debate. */
export function isKrLaneDeepApiBlocked(
  viewer: LaneViewer,
  category: string | null | undefined,
  instrument?: string | null,
): boolean {
  return Boolean(!viewer.isAdmin && isDeepDisabledForViewer(viewer, category, instrument))
}

/** Language selector: absent for Korean-lane non-admins; present for world lane and KR admins. */
export function shouldShowLeagueLanguageToggle(viewer: LaneViewer): boolean {
  if (admissionStockLane(viewer.jurisdiction) !== 'korea') return true
  return Boolean(viewer.isAdmin)
}
