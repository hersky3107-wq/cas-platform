/**
 * MOTIE diagnostic (진단형) — client-safe category definitions.
 *
 * Pure constants and types — NO server imports, NO connectors, NO 'server-only'.
 * Safe to import from both 'use client' pages and server-side engine files.
 *
 * diagnostic.ts (engine) imports FROM this file.
 * diagnostic/page.tsx (client) imports FROM this file.
 */

/** Mirrors JejuCouncilMode from brief.ts — defined locally to stay client-safe. */
export type CouncilMode = 'trade' | 'warroom'

export type DiagnosticCategory = {
  id: string
  emoji: string
  label: string
  /** Preset open question fired when the button is clicked. */
  presetQuestion: string
  /** Seed phrase for the Perplexity status search. */
  searchSeed: string
  /**
   * Data-backing level.
   * 'data'   = live public-data connector directly backs this category.
   * 'search' = Perplexity / AI search only; no live connector.
   * 'hybrid' = partial live connector data + search-augmented.
   */
  backing: 'data' | 'search' | 'hybrid'
  /** @deprecated Use `backing` instead. Kept for smooth migration of callers. */
  dataBacked: boolean
}

// ---------------------------------------------------------------------------
// TRADE mode — 산업별 수출참모 (10 items)
// ---------------------------------------------------------------------------

export const TRADE_DIAGNOSTIC_CATEGORIES: DiagnosticCategory[] = [
  {
    id: 'semiconductor',
    emoji: '💾',
    label: '반도체·디스플레이',
    presetQuestion: '지금 반도체·디스플레이 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 반도체 디스플레이 수출 동향 수급 최신',
    backing: 'search',
    dataBacked: false,
  },
  {
    id: 'automotive',
    emoji: '🚗',
    label: '자동차·모빌리티',
    presetQuestion: '지금 자동차·모빌리티 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 자동차 전기차 모빌리티 수출 동향 최신',
    backing: 'search',
    dataBacked: false,
  },
  {
    id: 'battery',
    emoji: '🔋',
    label: '이차전지·배터리',
    presetQuestion: '지금 이차전지·배터리 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 이차전지 배터리 수출 시장 경쟁 동향 최신',
    backing: 'search',
    dataBacked: false,
  },
  {
    id: 'machinery',
    emoji: '⚙️',
    label: '기계·로봇·장비',
    presetQuestion: '지금 기계·로봇·장비 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 기계 로봇 산업장비 수출 동향 최신',
    backing: 'search',
    dataBacked: false,
  },
  {
    id: 'beauty',
    emoji: '💄',
    label: '화장품·뷰티',
    presetQuestion: '지금 화장품·뷰티 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 화장품 뷰티 K-뷰티 수출 동향 최신',
    backing: 'search',
    dataBacked: false,
  },
  {
    id: 'kfood',
    emoji: '🍜',
    label: '식품·K-푸드',
    presetQuestion: '지금 식품·K-푸드 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 식품 K-푸드 농식품 수출 동향 최신',
    backing: 'search',
    dataBacked: false,
  },
  {
    id: 'biomedical',
    emoji: '🧬',
    label: '바이오·의료기기',
    presetQuestion: '지금 바이오·의료기기 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 바이오 의료기기 제약 수출 동향 최신',
    backing: 'search',
    dataBacked: false,
  },
  {
    id: 'steel-chem',
    emoji: '🏭',
    label: '철강·화학·소재',
    presetQuestion: '지금 철강·화학·소재 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 철강 화학 석유화학 소재 수출 동향 최신',
    backing: 'search',
    dataBacked: false,
  },
  {
    id: 'fashion',
    emoji: '👗',
    label: '패션·섬유·소비재',
    presetQuestion: '지금 패션·섬유·소비재 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 패션 섬유 소비재 수출 동향 최신',
    backing: 'search',
    dataBacked: false,
  },
  {
    id: 'green-energy-equip',
    emoji: '🌿',
    label: '친환경·에너지설비',
    presetQuestion: '지금 친환경·에너지설비 수출 현황과 가장 시급한 리스크·기회는?',
    searchSeed: '한국 친환경 에너지설비 태양광 풍력 수출 동향 최신',
    backing: 'search',
    dataBacked: false,
  },
]

// ---------------------------------------------------------------------------
// WARROOM mode — 자원별 에너지·자원 안보 워룸 (8 items)
// ---------------------------------------------------------------------------

export const WARROOM_DIAGNOSTIC_CATEGORIES: DiagnosticCategory[] = [
  {
    id: 'oil-prices',
    emoji: '🛢️',
    label: '석유·유가',
    presetQuestion: '지금 석유·유가 수급·가격 현황과 가장 시급한 안보 현안은?',
    searchSeed: '국제 유가 원유 수급 에너지 안보 최신 동향',
    backing: 'data',
    dataBacked: true,
  },
  {
    id: 'power-smp',
    emoji: '⚡',
    label: '전력·SMP',
    presetQuestion: '지금 전력·SMP 수급·가격 현황과 가장 시급한 안보 현안은?',
    searchSeed: '한국 전력 SMP 계통한계가격 전력수급 최신 동향',
    backing: 'data',
    dataBacked: true,
  },
  {
    id: 'gen-mix',
    emoji: '🔌',
    label: '발전믹스·에너지원',
    presetQuestion: '지금 발전믹스·에너지원 수급·가격 현황과 가장 시급한 안보 현안은?',
    searchSeed: '한국 발전원별 발전량 에너지믹스 전력 최신 현황',
    backing: 'data',
    dataBacked: true,
  },
  {
    id: 'lng',
    emoji: '🔵',
    label: '천연가스·LNG',
    presetQuestion: '지금 천연가스·LNG 수급·가격 현황과 가장 시급한 안보 현안은?',
    searchSeed: '한국 LNG 천연가스 도입 수입 가격 공급 안보 최신',
    backing: 'hybrid',
    dataBacked: true,
  },
  {
    id: 'nuclear',
    emoji: '⚛️',
    label: '원자력',
    presetQuestion: '지금 원자력 수급·가격 현황과 가장 시급한 안보 현안은?',
    searchSeed: '한국 원자력 원전 발전량 가동률 에너지 안보 최신',
    backing: 'hybrid',
    dataBacked: true,
  },
  {
    id: 'renewables',
    emoji: '☀️',
    label: '신재생·수소',
    presetQuestion: '지금 신재생·수소 수급·가격 현황과 가장 시급한 안보 현안은?',
    searchSeed: '한국 신재생에너지 태양광 풍력 수소 보급 최신 동향',
    backing: 'hybrid',
    dataBacked: true,
  },
]

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function getDiagnosticCategories(mode: CouncilMode): DiagnosticCategory[] {
  return mode === 'trade' ? TRADE_DIAGNOSTIC_CATEGORIES : WARROOM_DIAGNOSTIC_CATEGORIES
}

export function getDiagnosticCategory(
  id: string,
  mode: CouncilMode,
): DiagnosticCategory | undefined {
  return getDiagnosticCategories(mode).find((c) => c.id === id)
}
