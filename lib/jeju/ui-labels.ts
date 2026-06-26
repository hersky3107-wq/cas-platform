/** JEJU UI strings — use `getJejuUiPack(locale)`; Korean-primary fallback. */

export const JEJU_LOCALES = ['ko', 'en', 'ja', 'zh-TW', 'fr', 'ar', 'es'] as const

export type JejuLocale = (typeof JEJU_LOCALES)[number]

export type JejuThemeId = 'governance' | 'tourist' | 'resident'

export type JejuUiPack = {
  /** Root lobby */
  lobbyTitle: string
  lobbyTagline: string
  /** Mode tiles */
  modeGovernance: string
  modeGovernanceDesc: string
  modeTourist: string
  modeTouristDesc: string
  modeResident: string
  modeResidentDesc: string
  /** Governance sub-picker */
  governancePickerTitle: string
  governancePickerTagline: string
  deepTitle: string
  deepDesc: string
  liteTitle: string
  liteDesc: string
  mediaTitle: string
  mediaDesc: string
  /** Tourist sub-picker */
  touristPickerTitle: string
  touristPickerTagline: string
  domesticTitle: string
  domesticDesc: string
  foreignTitle: string
  foreignDesc: string
  foreignBadge: string
  /** Resident sub-picker */
  residentPickerTitle: string
  residentPickerTagline: string
  practicalTitle: string
  practicalDesc: string
  assistantTitle: string
  assistantDesc: string
  /** Placeholder leaf pages */
  placeholderNote: string
  placeholderBody: string
  /** Navigation */
  back: string
  backToJejuLobby: string
  backToGovernance: string
  backToTourist: string
  backToResident: string
  /** Main AIMANI lobby tile */
  aimaniLobbyLabel: string
  aimaniLobbySubtitle: string
}

const KO: JejuUiPack = {
  lobbyTitle: '제주',
  lobbyTagline: '거버넌스 · 관광 · 도민 — 모드를 선택하세요',
  modeGovernance: '거버넌스',
  modeGovernanceDesc: '정책 심의 · 데이터 · 언론',
  modeTourist: '관광객',
  modeTouristDesc: '방문 · 안내 · 번역',
  modeResident: '도민',
  modeResidentDesc: '생활 · 실무 · 쉬운 도우미',
  governancePickerTitle: '거버넌스',
  governancePickerTagline: '심층 심의 · 빠른 조회 · 언론·여론',
  deepTitle: '심층 심의',
  deepDesc: '다중 AI 전문가 심의 · 의장 판결',
  liteTitle: '빠른 조회',
  liteDesc: '실시간 데이터 · AI 브리핑',
  mediaTitle: '언론·여론',
  mediaDesc: '매스컴 논조 · 지역·전국 비교',
  touristPickerTitle: '관광객',
  touristPickerTagline: '내국인 · 외국인 안내',
  domesticTitle: '내국인',
  domesticDesc: '국내 방문객 맞춤 안내',
  foreignTitle: '외국인',
  foreignDesc: '해외 방문객 · 다국어',
  foreignBadge: '대행·번역 준비중',
  residentPickerTitle: '도민',
  residentPickerTagline: '생활·실무 · 쉬운 도우미',
  practicalTitle: '생활·실무',
  practicalDesc: '행정 · 생활정보 · 실무 조회',
  assistantTitle: '쉬운 도우미',
  assistantDesc: '큰 글씨 · 쉬운 말 · 접근성',
  placeholderNote: '준비 중',
  placeholderBody: '기능 연결 전입니다. 곧 이용하실 수 있습니다.',
  back: '뒤로',
  backToJejuLobby: '제주 홈',
  backToGovernance: '거버넌스',
  backToTourist: '관광객',
  backToResident: '도민',
  aimaniLobbyLabel: 'JEJU',
  aimaniLobbySubtitle: '제주 거버넌스 · 관광 · 도민',
}

// TODO(i18n): translate — non-Korean locales stub to Korean until copy is ready.
const STUB = KO

export const JEJU_UI: Record<JejuLocale, JejuUiPack> = {
  ko: KO,
  en: STUB,
  ja: STUB,
  'zh-TW': STUB,
  fr: STUB,
  ar: STUB,
  es: STUB,
}

function isJejuLocale(value: string): value is JejuLocale {
  return (JEJU_LOCALES as readonly string[]).includes(value)
}

/** Localized label pack; falls back to Korean. */
export function getJejuUiPack(locale: JejuLocale): JejuUiPack {
  return JEJU_UI[locale] ?? JEJU_UI.ko
}

/** Normalize browser / profile locale strings to a supported JEJU locale. */
export function normalizeJejuUiLocale(uiLocale: string | null | undefined): JejuLocale {
  if (!uiLocale) return 'ko'
  const raw = uiLocale.trim().toLowerCase()
  if (!raw) return 'ko'

  if (raw.startsWith('ko')) return 'ko'
  if (raw.startsWith('ja')) return 'ja'
  if (raw.startsWith('zh-tw') || raw.startsWith('zh-hk') || raw.includes('hant')) return 'zh-TW'
  if (raw.startsWith('zh')) return 'zh-TW'
  if (raw.startsWith('fr')) return 'fr'
  if (raw.startsWith('ar')) return 'ar'
  if (raw.startsWith('es')) return 'es'
  if (raw.startsWith('en')) return 'en'

  const base = raw.split('-')[0]
  if (isJejuLocale(base)) return base
  if (base === 'zh') return 'zh-TW'

  return 'ko'
}

/** Resolve UI locale from optional browser hint; Korean-primary default. */
export function resolveJejuLocale(uiLocale: string | null | undefined): JejuLocale {
  return normalizeJejuUiLocale(uiLocale)
}
