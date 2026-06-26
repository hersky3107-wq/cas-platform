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
  /** Shared result layout */
  evidenceShow: string
  evidenceHide: string
  errorHeading: string
  providerLabel: string
  /** Lite (빠른 조회) page */
  liteDailyBtn: string
  liteCustomPlaceholder: string
  liteRunBtn: string
  liteLoadingMsg: string
  liteLoadingHint: string
  liteBriefingHeading: string
  liteQuestionLabel: string
  liteSourcesHeading: string
  liteSourceOkBadge: string
  liteSourceErrBadge: string
  liteNoBriefing: string
  /** Media (언론 동향) page */
  mediaRefreshBtn: string
  mediaLoadingMsg: string
  mediaLoadingHint: string
  mediaSummaryHeading: string
  mediaCoreHeading: string
  mediaMinorHeading: string
  mediaNationalVsLocalHeading: string
  mediaSearchesHeading: string
  mediaSearchQueryLabel: string
  mediaSearchSourcesLabel: string
  mediaSearchFailed: string
  mediaDateLabel: string
  mediaNoSummary: string
  /** Deep (심층 심의) page */
  deepStartBtn: string
  deepQuestionPlaceholder: string
  deepRunningHint: string
  deepStageAnalysis: string
  deepStageSearch: string
  deepStageRevise: string
  deepStageDebate: string
  deepStageDeliberate: string
  deepStageVerdict: string
  deepStageDone: string
  deepRoundLabel: (n: number, score: number) => string
  deepRoundScoreLabel: string
  deepStoppedReason: (r: string) => string
  deepVerdictHeading: string
  deepJudgmentHeading: string
  deepBeat1Heading: string
  deepBeat2Heading: string
  deepBeat3Heading: string
  deepMinorityHeading: string
  deepMediaRiskHeading: string
  deepDisclaimerHeading: string
  deepConsensusLabel: string
  deepVoteHeading: string
  deepVoteOutcome: (o: string) => string
  deepVoteSummaryLabel: string
  deepNoVerdict: string
  deepEvidenceAnalysesHeading: string
  deepEvidenceSearchesHeading: string
  deepEvidenceRebuttalsHeading: string
  deepEvidenceDeliberationHeading: string
  deepEvidenceRoleLabel: string
  deepEvidenceQueryLabel: string
  deepEvidenceRoundLabel: (n: number) => string
  deepEvidenceAgreedLabel: string
  deepEvidenceContestedLabel: string
  /** Deep — live process sections */
  deepProcessHeading: string
  deepConvenedHeading: string
  deepPressAnalystYes: string
  deepPressAnalystNo: string
  deepRedTeamBadge: string
  deepMandateLabel: string
  deepDraftsHeading: string
  deepSearchLiveHeading: string
  deepSearchDroppedNote: (n: number) => string
  deepReviseHeading: string
  deepChangedBadge: string
  deepUnchangedBadge: string
  deepDebateLiveHeading: string
  deepRebuttalTargetLabel: string
  deepConsensusProgressionHeading: string
  deepRoundsLiveHeading: string
  deepTurnPosition: string
  deepTurnConcedes: string
  deepTurnHolds: string
  deepStageVote: string
  deepCollapse: string
  deepExpand: string
  deepWaiting: string
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
  governancePickerTagline: '심층 심의 · 빠른 조회 · 언론 동향',
  deepTitle: '심층 심의',
  deepDesc: '다중 AI 전문가 심의 · 의장 판결',
  liteTitle: '빠른 조회',
  liteDesc: '실시간 데이터 · AI 브리핑',
  mediaTitle: '언론 동향',
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
  // Shared result layout
  evidenceShow: '근거 보기',
  evidenceHide: '근거 닫기',
  errorHeading: '오류',
  providerLabel: '분석 모델',
  // Lite page
  liteDailyBtn: '오늘의 브리핑',
  liteCustomPlaceholder: '궁금한 제주 정책·현안을 질문하세요…',
  liteRunBtn: '조회',
  liteLoadingMsg: '실시간 데이터 수집 중…',
  liteLoadingHint: '공공데이터 수집 후 AI가 정리합니다. 30–60초 소요됩니다.',
  liteBriefingHeading: '브리핑',
  liteQuestionLabel: '질문',
  liteSourcesHeading: '수집 데이터 원문',
  liteSourceOkBadge: '수집 완료',
  liteSourceErrBadge: '수집 실패',
  liteNoBriefing: '브리핑을 생성하지 못했습니다.',
  // Media page
  mediaRefreshBtn: '새로 고침',
  mediaLoadingMsg: '언론 동향 검색 중…',
  mediaLoadingHint: '제주 관련 언론 보도를 실시간 검색 후 분석합니다. 30–60초 소요됩니다.',
  mediaSummaryHeading: '오늘의 언론 동향',
  mediaCoreHeading: '핵심 이슈',
  mediaMinorHeading: '주변 이슈',
  mediaNationalVsLocalHeading: '전국 vs 제주 지역 언론 논조',
  mediaSearchesHeading: '개별 검색 결과',
  mediaSearchQueryLabel: '검색어',
  mediaSearchSourcesLabel: '출처',
  mediaSearchFailed: '검색 실패',
  mediaDateLabel: '기준일',
  mediaNoSummary: '요약을 생성하지 못했습니다.',
  // Deep page
  deepStartBtn: '심의 시작',
  deepQuestionPlaceholder: '정책 질문을 입력하세요. (예: 제주 재생에너지 전환 전략은?)',
  deepRunningHint: '다중 AI 전문가 심의 중입니다. 총 3–7분 소요됩니다.',
  deepStageAnalysis: '전문가 분석 중…',
  deepStageSearch: '실시간 검색 중…',
  deepStageRevise: '재분석 중…',
  deepStageDebate: '토론 중…',
  deepStageDeliberate: '수렴 중…',
  deepStageVerdict: '의장 판결 작성 중…',
  deepStageDone: '심의 완료',
  deepRoundLabel: (n: number, score: number) => `라운드 ${n} — 합의도 ${score}점`,
  deepRoundScoreLabel: '합의도',
  deepStoppedReason: (r: string) => {
    if (r === 'target_reached') return '목표 합의도 달성'
    if (r === 'stalled') return '추가 수렴 없음(종료)'
    if (r === 'max_rounds') return '최대 라운드 도달'
    return '오류로 종료'
  },
  deepVerdictHeading: '의장 판결',
  deepJudgmentHeading: '최종 판단',
  deepBeat1Heading: '수집 데이터 요약',
  deepBeat2Heading: '전문가 분석·조사 요약',
  deepBeat3Heading: '토론·합의 과정',
  deepMinorityHeading: '마이너리티 리포트',
  deepMediaRiskHeading: '언론 수용 위험',
  deepDisclaimerHeading: '참고 사항',
  deepConsensusLabel: '최종 합의도',
  deepVoteHeading: '심의체 표결',
  deepVoteOutcome: (o: string) => {
    if (o === 'approved') return '다수 승인'
    if (o === 'rejected') return '다수 반대'
    return '가부동수'
  },
  deepVoteSummaryLabel: '표결 결과',
  deepNoVerdict: '의장 판결을 생성하지 못했습니다.',
  deepEvidenceAnalysesHeading: '전문가 초안 분석',
  deepEvidenceSearchesHeading: '검색 결과',
  deepEvidenceRebuttalsHeading: '반론',
  deepEvidenceDeliberationHeading: '라운드별 수렴 경과',
  deepEvidenceRoleLabel: '역할',
  deepEvidenceQueryLabel: '검색어',
  deepEvidenceRoundLabel: (n: number) => `라운드 ${n}`,
  deepEvidenceAgreedLabel: '합의 사항',
  deepEvidenceContestedLabel: '미합의 사항',
  // Deep — live process sections
  deepProcessHeading: '심의 과정',
  deepConvenedHeading: '전문가 소집',
  deepPressAnalystYes: '언론 분석가 소집됨',
  deepPressAnalystNo: '언론 분석가 미소집',
  deepRedTeamBadge: '레드팀',
  deepMandateLabel: '직무',
  deepDraftsHeading: '각 전문가 초기 분석',
  deepSearchLiveHeading: '실시간 검색 결과',
  deepSearchDroppedNote: (n: number) => `(상한 초과로 ${n}건 생략)`,
  deepReviseHeading: '재분석 (검색 반영)',
  deepChangedBadge: '입장 변경',
  deepUnchangedBadge: '입장 유지',
  deepDebateLiveHeading: '토론 (반론)',
  deepRebuttalTargetLabel: '대상',
  deepConsensusProgressionHeading: '라운드별 합의도',
  deepRoundsLiveHeading: '토론 라운드',
  deepTurnPosition: '입장',
  deepTurnConcedes: '수용',
  deepTurnHolds: '견지',
  deepStageVote: '표결 중…',
  deepCollapse: '접기',
  deepExpand: '펼치기',
  deepWaiting: '대기 중…',
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
