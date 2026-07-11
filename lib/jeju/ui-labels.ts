/** JEJU UI strings — use `getJejuUiPack(locale)`; Korean-primary fallback. */

export const JEJU_LOCALES = ['ko', 'en', 'ja', 'zh-TW', 'zh-CN', 'fr', 'ar', 'es'] as const

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
  deepKeyIssuesHeading: string
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
  /** Deliberate (Mode B — 찬반 심의) page */
  deliberateTitle: string
  deliberateDesc: string
  deliberateStartBtn: string
  deliberateQuestionPlaceholder: string
  deliberateRunningHint: (debaterCount: number, voterCount: number) => string
  deliberateStageStart: string
  deliberateStageReport: string
  deliberateStageOpen: string
  deliberateStageTurn: string
  deliberateStageFacilitate: string
  deliberateStageVote: string
  deliberateStageVerdict: string
  deliberateReportHeading: string
  deliberateLeadAnalysisHeading: string
  deliberateSearchesUsedHeading: string
  deliberateRosterHeading: string
  deliberateDebaterLabel: string
  deliberateDebateHeading: string
  deliberateOpeningHeading: string
  deliberateRoundLabel: (n: number, score: number) => string
  deliberateActionTagLabel: string
  deliberateClaimLabel: string
  deliberateNextDirectiveLabel: string
  deliberateAgreePointsLabel: string
  deliberateOpenIssuesLabel: string
  deliberateFacilitatorScore: string
  deliberateConsensusProgressionHeading: string
  deliberateRedTeamBadge: string
  deliberateSearchSpecialist: string
  deliberateSearchSpecialistDesc: string
  deliberateSearchByline: string
  deliberateVoteAllPanel: (voterCount: number) => string
  /** Brief (Mode A — 개방형 라이트) page */
  briefTitle: string
  briefDesc: string
  briefStartBtn: string
  briefQuestionPlaceholder: string
  briefRunningHint: (analystCount: number) => string
  briefStageStart: string
  briefStageOrchestrate: string
  briefStagePreReport: string
  briefStageAnalyses: string
  briefStageSynthesize: string
  briefSynthesisHeading: string
  briefRecommendHeading: string
  briefReportHeading: string
  briefLeadAnalysisHeading: string
  briefSearchesHeading: string
  briefRosterHeading: string
  briefAnalysesHeading: string
  briefSubQuestionLabel: string
  briefDoubledBadge: string
  briefSearchSpecialist: string
  briefSearchSpecialistDesc: string
  briefSearchByline: string
  briefNoSynthesis: string
  briefMandateLabel: string
  briefPromptSectionLabel: string
  briefDiagnosticSectionLabel: string
  /** Diagnostic (진단형 — 카테고리 빠른 브리핑) page */
  diagnosticTitle: string
  diagnosticDesc: string
  diagnosticCategoryHeading: string
  diagnosticCustomHeading: string
  diagnosticCustomPlaceholder: string
  diagnosticRunBtn: string
  diagnosticRunningHint: string
  diagnosticStageStart: string
  diagnosticStageSearch: string
  diagnosticStageStatus: string
  diagnosticStageIssues: string
  diagnosticStatusHeading: string
  diagnosticIssuesHeading: string
  diagnosticSearchesHeading: string
  diagnosticSearchByline: string
  diagnosticNoResult: string
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
  residentPickerTagline: '일반 · 어르신 — 모드를 선택하세요',
  practicalTitle: '일반',
  practicalDesc: '해녀·조업·물가·복지 등 생활 정보',
  assistantTitle: '어르신',
  assistantDesc: '큰 글씨 · 읽어주기 · 복지 찾기',
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
  deepKeyIssuesHeading: '핵심 쟁점',
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
  // Deliberate page (Mode B — 찬반 심의)
  deliberateTitle: '찬반 심의',
  deliberateDesc: 'SYNOD 토론 · 합의도 수렴 · 의장 판결',
  deliberateStartBtn: '심의 시작',
  deliberateQuestionPlaceholder: '찬반을 따질 정책 안건을 입력하세요. (예: 제주 렌터카 총량제 강화)',
  deliberateRunningHint: (debaterCount, voterCount) =>
    debaterCount > 0
      ? `${debaterCount}개 AI가 토론하고, 퍼플렉시티를 포함한 ${voterCount}개 AI가 표결합니다. 총 4–8분 소요됩니다.`
      : 'AI 심의체가 순서대로 토론하고 표결합니다. 총 4–8분 소요됩니다.',
  deliberateStageStart: '데이터 수집·소집 중…',
  deliberateStageReport: '사전 분석 리포트 작성 중…',
  deliberateStageOpen: '개회 발언 중…',
  deliberateStageTurn: '토론 라운드 진행 중…',
  deliberateStageFacilitate: '라운드 정리 중…',
  deliberateStageVote: '표결 중…',
  deliberateStageVerdict: '의장 판결 작성 중…',
  deliberateReportHeading: '사전 분석 리포트',
  deliberateLeadAnalysisHeading: '수석 분석가 1차 분석',
  deliberateSearchesUsedHeading: '보완 검색 결과',
  deliberateRosterHeading: '토론 브랜드',
  deliberateDebaterLabel: '토론자',
  deliberateDebateHeading: '토론 경과',
  deliberateOpeningHeading: '개회 발언 (라운드 0)',
  deliberateRoundLabel: (n: number, score: number) => `라운드 ${n} — 합의도 ${score >= 0 ? `${score}점` : '—'}`,
  deliberateActionTagLabel: '행동',
  deliberateClaimLabel: '핵심 주장',
  deliberateNextDirectiveLabel: '다음 라운드 지침',
  deliberateAgreePointsLabel: '합의된 지점',
  deliberateOpenIssuesLabel: '미합의 쟁점',
  deliberateFacilitatorScore: '합의도',
  deliberateConsensusProgressionHeading: '라운드별 합의도 추이',
  deliberateRedTeamBadge: '논리 검증',
  deliberateSearchSpecialist: '실시간 검색·언론 동향 담당 (Perplexity)',
  deliberateSearchSpecialistDesc:
    '패널 전체를 대신해 웹 검색과 언론 보도 동향을 전담 조사합니다. 토론에는 참여하지 않지만, 수집한 근거는 사전 분석 리포트와 최종 표결에 반영됩니다.',
  deliberateSearchByline: 'Perplexity가 패널을 대신해 수행한 실시간 검색',
  deliberateVoteAllPanel: (voterCount) => `심의체 전원(${voterCount}) 표결`,
  // Brief (개방형 라이트) page
  briefTitle: '개방형 브리핑',
  briefDesc: '상황 분석 · 병렬 전문가 검토 · 권고안 제시 (토론·표결 없음)',
  briefStartBtn: '브리핑 시작',
  briefQuestionPlaceholder:
    '개방형 질문을 입력하세요. (예: 에너지·계통 분야에서 지금 가장 시급한 현안은?)',
  briefRunningHint: (analystCount) =>
    `${analystCount}개 AI가 병렬 분석하고, Opus가 통합 권고안을 작성합니다. 총 3–5분 소요됩니다.`,
  briefStageStart: '데이터 수집',
  briefStageOrchestrate: '분석 배치',
  briefStagePreReport: '상황 브리핑',
  briefStageAnalyses: '병렬 분석',
  briefStageSynthesize: '통합 권고',
  briefSynthesisHeading: '통합 브리핑 · 권고안',
  briefRecommendHeading: '★ 권고 (추천안 · B안 · C안)',
  briefReportHeading: '사전 상황 브리핑',
  briefLeadAnalysisHeading: '수석 분석가 1차 검토',
  briefSearchesHeading: 'Perplexity 검색 결과',
  briefRosterHeading: '분석 좌석 배치',
  briefAnalysesHeading: 'AI 병렬 분석',
  briefSubQuestionLabel: '분석 과제',
  briefDoubledBadge: '중점 각도',
  briefSearchSpecialist: '실시간 검색·언론 동향 담당 (Perplexity)',
  briefSearchSpecialistDesc:
    '토론에는 참여하지 않으며, 패널 전체를 위해 최신 외부 정보·언론 동향을 검색·수집합니다.',
  briefSearchByline: 'Perplexity가 패널을 대신해 수행한 실시간 검색',
  briefNoSynthesis: '통합 브리핑을 생성하지 못했습니다.',
  briefMandateLabel: '직무',
  briefPromptSectionLabel: '구체적인 현안을 질문하세요 — 7개 AI 심층 분석',
  briefDiagnosticSectionLabel: '또는 분야별 빠른 진단',
  // Diagnostic (진단형) page
  diagnosticTitle: '진단 브리핑',
  diagnosticDesc: '분야별 오늘의 현황 + 가장 시급한 현안 (토론·표결 없음)',
  diagnosticCategoryHeading: '분야 선택',
  diagnosticCustomHeading: '직접 질문',
  diagnosticCustomPlaceholder: '특정 현안을 직접 질문하세요. (예: 오늘 제주 전력 수급 현황은?)',
  diagnosticRunBtn: '진단 시작',
  diagnosticRunningHint:
    'Perplexity 검색 후, 데이터 분석가(현황)와 진단가(시급 사안)가 차례로 작성합니다. 약 1분 소요됩니다.',
  diagnosticStageStart: '데이터 수집',
  diagnosticStageSearch: '실시간 검색',
  diagnosticStageStatus: '오늘의 현황',
  diagnosticStageIssues: '시급 사안 진단',
  diagnosticStatusHeading: '오늘의 현황',
  diagnosticIssuesHeading: '가장 시급·중요한 사안',
  diagnosticSearchesHeading: 'Perplexity 검색 결과',
  diagnosticSearchByline: 'Perplexity가 수행한 실시간 검색',
  diagnosticNoResult: '진단 결과를 생성하지 못했습니다.',
}

// TODO(i18n): translate — non-Korean locales stub to Korean until copy is ready.
const STUB = KO

export const JEJU_UI: Record<JejuLocale, JejuUiPack> = {
  ko: KO,
  en: STUB,
  ja: STUB,
  'zh-TW': STUB,
  'zh-CN': STUB,
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
  // Simplified Chinese must be detected BEFORE the generic zh→zh-TW fallback.
  if (raw.startsWith('zh-cn') || raw.startsWith('zh-sg') || raw.includes('hans')) return 'zh-CN'
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
