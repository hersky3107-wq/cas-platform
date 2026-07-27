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
  /** Governance hub tile labels (correct, hub-scoped; separate from page headers) */
  hubDeliberateTitle: string
  hubDeliberateDesc: string
  hubBriefTitle: string
  hubBriefDesc: string
  hubDiagnosticTitle: string
  hubDiagnosticDesc: string
  hubMediaTitle: string
  hubMediaDesc: string
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
  /** AX COUNCIL brand + trade/warroom mode toggle */
  brandTitle: string
  brandSubtitle: string
  modeTrade: string
  modeTradeEn: string
  modeWarroom: string
  modeWarroomEn: string
  tradeCopy: string
  warroomCopy: string
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
  /** One-line explainer shown under the consensus score — low score ≠ failure. */
  deepConsensusExplainer: string
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
  deliberateQuestionPlaceholderTrade: string
  deliberateQuestionPlaceholderWarroom: string
  deliberateQuestionHelper: string
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
  /** Explicit seat breakdown for the ballot header — e.g. "토론 8석 + 검색 1석 = 표결 9석". */
  deliberateVoteSeatBreakdown: (debateSeatCount: number, searchSeatCount: number, totalSeatCount: number) => string
  /** Shown on a debate turn card when that seat produced no usable statement this round. */
  deliberateSeatFailedBadge: string
  /** Static disclosure banner at the top of the deliberation page — who the 8 AI panel are. */
  gunpoPanelNoticeTitle: string
  gunpoPanelNoticeBody: string
  /** Shown at the top of a result report when it ran with no user-submitted attachments. */
  publicDataNoticeBody: string
  /** Brief (Mode A — 개방형 라이트) page */
  briefTitle: string
  briefDesc: string
  briefStartBtn: string
  briefQuestionPlaceholderTrade: string
  briefQuestionPlaceholderWarroom: string
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
  diagnosticCustomPlaceholderTrade: string
  diagnosticCustomPlaceholderWarroom: string
  diagnosticCustomHelper: string
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

/**
 * GUNPO UI copy (cloned from lib/motie/ui-labels.ts).
 *
 * STEP 2 (구조 복제) STATE: structural/generic UI strings (buttons, headings,
 * badges) were kept AS-IS since they don't reference any place/domain. Every
 * field that named "제주" or carried 도시·정비/시민·정주-specific example copy
 * (brand text, mode labels, question placeholders, hint text) was emptied to
 * '' with a TODO(군포) comment — filling these in is a later content step.
 */
const KO: JejuUiPack = {
  lobbyTitle: '', // TODO(군포): '제주' → 군포시 표기
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
  // Governance hub tiles — correct labels for the 4-mode launcher
  hubDeliberateTitle: '찬반형 심의',
  hubDeliberateDesc:
    '8개 AI가 찬성·반대로 나뉘어 토론하고, 검색·언론 동향을 전담하는 Perplexity가 더해진 9개 AI가 민주적으로 표결하며, 소수의견까지 보존해 의장이 판결하는 심층 심의.',
  hubBriefTitle: '개방형 브리핑',
  hubBriefDesc:
    '여러 AI가 서로 다른 전문 분야와 관점으로 분석해 종합 브리핑을 만드는 열린 진단.',
  hubDiagnosticTitle: '진단형 스캔',
  hubDiagnosticDesc: '분야를 선택하면 현황과 가장 시급한 현안을 빠르게 진단.',
  hubMediaTitle: '언론 동향',
  hubMediaDesc: '관련 뉴스·현지 언론을 자동 수집해 여론 흐름을 포착.',
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
  backToJejuLobby: '', // TODO(군포): '제주 홈' → 군포시 표기
  backToGovernance: '거버넌스',
  backToTourist: '관광객',
  backToResident: '도민',
  aimaniLobbyLabel: 'GUNPO',
  aimaniLobbySubtitle: '', // TODO(군포): '제주 거버넌스 · 관광 · 도민' → 군포시 표기
  // AX COUNCIL brand + trade/warroom mode toggle
  brandTitle: 'AX 군포',
  brandSubtitle: '', // TODO(군포): 브랜드 서브타이틀
  modeTrade: '도시·정비',
  modeTradeEn: '', // TODO(군포): English label
  modeWarroom: '시민·정주',
  modeWarroomEn: '', // TODO(군포): English label
  tradeCopy: '', // TODO(군포): 도시·정비 축 소개 문구
  warroomCopy: '', // TODO(군포): 시민·정주 축 소개 문구
  // Shared result layout
  evidenceShow: '근거 보기',
  evidenceHide: '근거 닫기',
  errorHeading: '오류',
  providerLabel: '분석 모델',
  // Lite page
  liteDailyBtn: '오늘의 브리핑',
  liteCustomPlaceholder: '궁금한 정책·현안을 질문하세요…', // TODO(군포): 예시 문구 보강
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
  mediaLoadingHint: '관련 언론 보도를 실시간 검색 후 분석합니다. 30–60초 소요됩니다.', // TODO(군포): 지역명 명시
  mediaSummaryHeading: '오늘의 언론 동향',
  mediaCoreHeading: '핵심 이슈',
  mediaMinorHeading: '주변 이슈',
  mediaNationalVsLocalHeading: '전국 vs 지역 언론 논조', // TODO(군포): 지역명 명시
  mediaSearchesHeading: '개별 검색 결과',
  mediaSearchQueryLabel: '검색어',
  mediaSearchSourcesLabel: '출처',
  mediaSearchFailed: '검색 실패',
  mediaDateLabel: '기준일',
  mediaNoSummary: '요약을 생성하지 못했습니다.',
  // Deep page
  deepStartBtn: '심의 시작',
  deepQuestionPlaceholder: '', // TODO(군포): 정책 질문 placeholder 예시 문구
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
  deepKeyIssuesHeading: '핵심 쟁점 (3줄 요약)',
  deepJudgmentHeading: '최종 판단',
  deepBeat1Heading: '수집 데이터 요약',
  deepBeat2Heading: '전문가 분석·조사 요약',
  deepBeat3Heading: '토론·합의 과정',
  deepMinorityHeading: '소수의견 (마이너리티 리포트)',
  deepMediaRiskHeading: '언론 수용 위험',
  deepDisclaimerHeading: '참고 사항',
  deepConsensusLabel: '최종 합의도',
  deepConsensusExplainer:
    '합의도는 쟁점 수렴 정도입니다. 논의가 원론에서 구체 설계로 내려가면 점수가 낮아질 수 있으며, 이는 실패가 아니라 쟁점이 구체화됐다는 신호입니다.',
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
  deliberateStartBtn: '결정 심의',
  deliberateQuestionPlaceholderTrade:
    '예: 산본 재정비촉진구역의 이주주택을 당정동에 원안 규모로 배치할 것인가',
  deliberateQuestionPlaceholderWarroom:
    '예: 산본 재정비촉진구역의 이주주택을 당정동에 원안 규모로 배치할 것인가',
  deliberateQuestionHelper:
    '찬성과 반대가 나뉠 수 있는 문장을 입력해주세요. (\'~해야 하는가?\'처럼 예/아니오로 답할 수 있는 형태)',
  deliberateRunningHint: (debaterCount, voterCount) =>
    debaterCount > 0
      ? `${debaterCount}개 AI가 토론하고, 퍼플렉시티를 포함한 ${voterCount}개 AI가 표결합니다. 보통 8~11분 소요됩니다.`
      : 'AI 심의체가 순서대로 토론하고 표결합니다. 보통 8~11분 소요됩니다.',
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
  deliberateVoteSeatBreakdown: (debateSeatCount, searchSeatCount, totalSeatCount) =>
    searchSeatCount > 0
      ? `토론 ${debateSeatCount}석 + 검색 ${searchSeatCount}석 = 표결 ${totalSeatCount}석`
      : `표결 ${totalSeatCount}석`,
  deliberateSeatFailedBadge: '응답 실패 — 이 라운드 불참',
  gunpoPanelNoticeTitle: '8개 AI 심의체',
  gunpoPanelNoticeBody:
    '서로 다른 8개 회사의 AI가 각각 다른 담당 분야를 맡아 동시에 분석하고, 이견이 있으면 지우지 않고 남긴 뒤 의장 AI가 종합 판정합니다.\n' +
    '참여: OpenAI(챗지피티)·Anthropic(클로드)·Google(제미나이)·xAI(그록)·Mistral·DeepSeek·Upstage(솔라)·LG(엑사원) — 이 중 두 개는 국내에서 개발된 모델입니다.\n' +
    '최종 결정은 담당 공무원이 합니다. 이 시스템은 검토 자료를 만듭니다.',
  publicDataNoticeBody:
    "이 결과는 공개 자료만으로 작성되었습니다.\n" +
    "본문에 '미확인'과 '[확인 필요]'가 반복되는 것은 오류가 아닙니다. 확인되지 않은 수치를 지어내지 않도록 설계했기 때문입니다.\n" +
    "'첨부·추가 자료'에 시청 내부 문서를 올리면 같은 심의가 그 자료를 근거로 다시 실행되고, 위 공백 항목들이 채워집니다.",
  // Brief (개방형 라이트) page
  briefTitle: '개방형 브리핑',
  briefDesc: '상황 분석 · 병렬 전문가 검토 · 권고안 제시 (토론·표결 없음)',
  briefStartBtn: '종합 분석',
  briefQuestionPlaceholderTrade:
    '예: 군포시 20·30대 인구 유출을 완화하려면 어떤 정책 영역을 우선 검토해야 하는가',
  briefQuestionPlaceholderWarroom:
    '예: 군포시 20·30대 인구 유출을 완화하려면 어떤 정책 영역을 우선 검토해야 하는가',
  briefRunningHint: (analystCount) =>
    `${analystCount}개 AI가 각자 다른 관점으로 병렬 분석하고, 실시간 검색 AI가 현지 언론·규제를 조사하며, 최고급 통합 AI가 종합 권고안을 작성합니다. 총 3~5분 소요됩니다.`,
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
  briefPromptSectionLabel: '구체적인 현안을 질문하세요 — 8개 AI 심층 분석',
  briefDiagnosticSectionLabel: '또는 분야별 빠른 진단',
  // Diagnostic (진단형) page
  diagnosticTitle: '진단 브리핑',
  diagnosticDesc: '분야별 오늘의 현황 + 가장 시급한 현안 (토론·표결 없음)',
  diagnosticCategoryHeading: '분야 선택',
  diagnosticCustomHeading: '직접 질문',
  diagnosticCustomPlaceholderTrade:
    '예: 당정동 복합지구의 이주주택 공급 규모를 원안대로 유지할 것인가',
  diagnosticCustomPlaceholderWarroom:
    '예: 산본 재정비 추진 현황과 가장 시급한 현안은 무엇인가',
  diagnosticCustomHelper:
    '위 분야에 없거나 더 구체적인 현안을 직접 질문하시려면 여기에 입력하세요. (분야 버튼을 누르면 해당 분야의 프리셋 질문이 실행됩니다.)',
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
