/**
 * JEJU TOURIST mode UI strings — use `getTouristUiPack(locale)` or the
 * `useTouristUi()` hook (components/jeju/useTouristUi.ts).
 *
 * Korean (KO) is the source of truth with REAL values. Other locales spread KO
 * as a fallback (`...KO`) and override only the strings that have been
 * translated so far. This lets us translate incrementally without ever showing
 * an empty string — untranslated keys safely render Korean.
 *
 * Step 1 (this file): high-value short strings are translated NOW
 *   - chip labels
 *   - section headings
 *   - search box placeholder / button
 * Everything else (long notes, loading messages, course form) stays KO stub and
 * will be filled in later steps.
 */

export const TOURIST_LOCALES = ['ko', 'en', 'ja', 'zh-TW', 'zh-CN'] as const

export type TouristLocale = (typeof TOURIST_LOCALES)[number]

export type TouristUiPack = {
  // ── Page header ──
  pageTitle: string

  // ── Search box ──
  searchPlaceholder: string
  searchButton: string

  // ── Chip labels ──
  chipCourse: string
  chipLocal: string
  chipFestival: string
  chipSeasonal: string
  chipRainy: string
  chipIslands: string
  chipOlle: string
  chipOreum: string

  // ── Section headings (emoji kept inline to match current layout) ──
  headingRainy: string
  headingLocal: string
  headingFestivalSonar: string
  headingFestivalFallback: string
  headingSeasonal: string
  headingIslands: string
  headingOreum: string
  headingDullegil: string
  headingOlle: string

  // ── Section notes (long — KO stub for now) ──
  noteRainy: string
  noteLocal: string
  noteFestivalSonar: string
  noteFestivalFallback: string
  noteSeasonal: string
  noteIslands: string
  noteOreum: string
  noteDullegil: string
  noteOlle: string

  // ── Loading / error / retry (KO stub for now) ──
  retryMessage: string
  retryButton: string

  // ── Featured (server page) ──
  featuredHeading: string
  featuredBadge: string
  emptyTitle: string
  emptySubtitle: string
  sourceAttribution: string
}

// ── Korean — source of truth (real values) ─────────────────────────────────────

const KO: TouristUiPack = {
  pageTitle: '제주 AI 여행 안내',

  searchPlaceholder: '제주에서 뭐 하고 싶으세요?',
  searchButton: '찾기',

  chipCourse: 'AI 여행 코스 짜기',
  chipLocal: '관광객은 잘 모르는',
  chipFestival: '이번 주 축제',
  chipSeasonal: '지금 제주 풍경',
  chipRainy: '비 와도 좋은 곳',
  chipIslands: '섬 여행',
  chipOlle: '올레길',
  chipOreum: '오름·한라산',

  headingRainy: '☔ 비 와도 좋은 곳',
  headingLocal: '👀 관광객은 잘 모르는 제주',
  headingFestivalSonar: '🎪 지금 제주 축제·공연',
  headingFestivalFallback: '🎪 제주 축제·공연·전시',
  headingSeasonal: '🌸 지금 제주 풍경',
  headingIslands: '⛴️ 배 타고 가는 제주 섬',
  headingOreum: '🌋 제주 오름',
  headingDullegil: '🏔 한라산 둘레길',
  headingOlle: '🥾 제주 올레길',

  noteRainy: '비짓제주 공식 정보 기반',
  noteLocal: '공식 자연·문화 명소 + 현지인 추천을 섞어 보여드려요 · 웹 정보는 방문 전 확인하세요',
  noteFestivalSonar: '공식 채널 기준 진행 중·예정 행사예요 · 날짜·장소는 방문 전 확인하세요',
  noteFestivalFallback: '비짓제주 공식 행사 목록이에요 · 정확한 일정은 방문 전 확인하세요',
  noteSeasonal: '🌐 웹에서 찾은 실시간 정보예요 · 현장 상황은 변동될 수 있어요',
  noteIslands: '🌐 웹에서 찾은 정보예요 · 시간표·요금은 자주 바뀌니 방문 전 운항사 확인 필수',
  noteOreum: '제주의 오름을 소개해요 · 출처: 제주특별자치도 공공데이터 · 탐방 전 현장 상황을 확인하세요',
  noteDullegil: '한라산 국립공원을 한 바퀴 도는 8개 코스예요 · 출처: 제주특별자치도 · 제주데이터허브 (2021 기준)',
  noteOlle: '사단법인 제주올레 공식 코스 정보예요 · 출처: 제주올레 + 공공데이터포털',

  retryMessage: '조금 더 오래 걸리고 있어요. 다시 시도할까요?',
  retryButton: '다시 시도',

  featuredHeading: '지금 뜨는 제주',
  featuredBadge: '실시간 비짓제주',
  emptyTitle: '지금 제주 정보를 불러오지 못했어요.',
  emptySubtitle: '잠시 후 다시 시도해 주세요.',
  sourceAttribution: '정보·이미지 출처: 비짓제주(제주관광공사)',
}

// ── English — KO fallback + high-value overrides ───────────────────────────────

const EN: TouristUiPack = {
  ...KO,
  pageTitle: 'Jeju AI Travel Guide',

  searchPlaceholder: 'What do you want to do in Jeju?',
  searchButton: 'Search',

  chipCourse: 'AI Trip Planner',
  chipLocal: 'Hidden Local Spots',
  chipFestival: "This Week's Festivals",
  chipSeasonal: 'Jeju Right Now',
  chipRainy: 'Great Even in Rain',
  chipIslands: 'Island Trips',
  chipOlle: 'Olle Trails',
  chipOreum: 'Oreum & Hallasan',

  headingRainy: '☔ Great Even in the Rain',
  headingLocal: '👀 Jeju Only Locals Know',
  headingFestivalSonar: '🎪 Jeju Festivals & Shows Now',
  headingFestivalFallback: '🎪 Jeju Festivals · Shows · Exhibits',
  headingSeasonal: '🌸 Jeju Scenery Right Now',
  headingIslands: '⛴️ Jeju Islands by Ferry',
  headingOreum: '🌋 Jeju Oreum',
  headingDullegil: '🏔 Hallasan Dullegil',
  headingOlle: '🥾 Jeju Olle Trail',

  featuredHeading: 'Trending in Jeju',
  featuredBadge: 'Live · VisitJeju',
}

// ── Japanese — KO fallback + high-value overrides ──────────────────────────────

const JA: TouristUiPack = {
  ...KO,
  pageTitle: '済州 AI 旅行ガイド',

  searchPlaceholder: '済州で何をしたいですか？',
  searchButton: '検索',

  chipCourse: 'AI旅行コース',
  chipLocal: '地元の人だけが知る',
  chipFestival: '今週のお祭り',
  chipSeasonal: '今の済州の風景',
  chipRainy: '雨でも楽しめる',
  chipIslands: '島めぐり',
  chipOlle: 'オルレギル',
  chipOreum: 'オルム・漢拏山',

  headingRainy: '☔ 雨でも楽しめる場所',
  headingLocal: '👀 地元の人が知る済州',
  headingFestivalSonar: '🎪 今の済州フェス・公演',
  headingFestivalFallback: '🎪 済州フェス・公演・展示',
  headingSeasonal: '🌸 今の済州の風景',
  headingIslands: '⛴️ 船で行く済州の島',
  headingOreum: '🌋 済州のオルム',
  headingDullegil: '🏔 漢拏山ドゥルレギル',
  headingOlle: '🥾 済州オルレギル',

  featuredHeading: '今の済州の話題',
  featuredBadge: 'リアルタイム · VisitJeju',
}

// ── Traditional Chinese — KO fallback + high-value overrides ───────────────────

const ZH_TW: TouristUiPack = {
  ...KO,
  pageTitle: '濟州 AI 旅遊指南',

  searchPlaceholder: '想在濟州做什麼？',
  searchButton: '搜尋',

  chipCourse: 'AI行程規劃',
  chipLocal: '在地人才知道',
  chipFestival: '本週慶典',
  chipSeasonal: '此刻濟州風景',
  chipRainy: '雨天也很棒',
  chipIslands: '跳島之旅',
  chipOlle: '偶來小路',
  chipOreum: '小火山·漢拏山',

  headingRainy: '☔ 雨天也很棒的地方',
  headingLocal: '👀 在地人才知道的濟州',
  headingFestivalSonar: '🎪 此刻濟州慶典·演出',
  headingFestivalFallback: '🎪 濟州慶典·演出·展覽',
  headingSeasonal: '🌸 此刻濟州風景',
  headingIslands: '⛴️ 搭船去濟州離島',
  headingOreum: '🌋 濟州小火山',
  headingDullegil: '🏔 漢拏山環山步道',
  headingOlle: '🥾 濟州偶來小路',

  featuredHeading: '濟州正夯',
  featuredBadge: '即時 · VisitJeju',
}

// ── Simplified Chinese — KO fallback + high-value overrides ────────────────────

const ZH_CN: TouristUiPack = {
  ...KO,
  pageTitle: '济州 AI 旅游指南',

  searchPlaceholder: '想在济州做什么？',
  searchButton: '搜索',

  chipCourse: 'AI行程规划',
  chipLocal: '当地人才知道',
  chipFestival: '本周庆典',
  chipSeasonal: '此刻济州风景',
  chipRainy: '雨天也很棒',
  chipIslands: '跳岛之旅',
  chipOlle: '偶来小路',
  chipOreum: '小火山·汉拿山',

  headingRainy: '☔ 雨天也很棒的地方',
  headingLocal: '👀 当地人才知道的济州',
  headingFestivalSonar: '🎪 此刻济州庆典·演出',
  headingFestivalFallback: '🎪 济州庆典·演出·展览',
  headingSeasonal: '🌸 此刻济州风景',
  headingIslands: '⛴️ 坐船去济州离岛',
  headingOreum: '🌋 济州小火山',
  headingDullegil: '🏔 汉拿山环山步道',
  headingOlle: '🥾 济州偶来小路',

  featuredHeading: '济州正热',
  featuredBadge: '实时 · VisitJeju',
}

export const TOURIST_UI: Record<TouristLocale, TouristUiPack> = {
  ko: KO,
  en: EN,
  ja: JA,
  'zh-TW': ZH_TW,
  'zh-CN': ZH_CN,
}

/** Language options for the 🌐 toggle. Autonyms — identical in every locale. */
export const TOURIST_LANG_OPTIONS: { code: TouristLocale; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'zh-CN', label: '简体中文' },
]

function isTouristLocale(value: string): value is TouristLocale {
  return (TOURIST_LOCALES as readonly string[]).includes(value)
}

/** Localized tourist label pack; falls back to Korean. */
export function getTouristUiPack(locale: TouristLocale): TouristUiPack {
  return TOURIST_UI[locale] ?? TOURIST_UI.ko
}

/** Normalize a browser / stored locale string to a supported tourist locale. */
export function normalizeTouristLocale(uiLocale: string | null | undefined): TouristLocale {
  if (!uiLocale) return 'ko'
  const raw = uiLocale.trim().toLowerCase()
  if (!raw) return 'ko'

  if (raw.startsWith('ko')) return 'ko'
  if (raw.startsWith('ja')) return 'ja'
  // Simplified Chinese must be detected BEFORE the generic zh→zh-TW fallback.
  if (raw.startsWith('zh-cn') || raw.startsWith('zh-sg') || raw.includes('hans')) return 'zh-CN'
  if (raw.startsWith('zh-tw') || raw.startsWith('zh-hk') || raw.includes('hant')) return 'zh-TW'
  if (raw.startsWith('zh')) return 'zh-TW'
  if (raw.startsWith('en')) return 'en'

  const base = raw.split('-')[0] ?? ''
  if (isTouristLocale(base)) return base

  return 'ko'
}
