import type { CrisisLocale } from './locales'
import { HAZARD_UI_EN, HAZARD_UI_KO, type HazardUiSlice } from './hazards'

export type CrisisUiPack = {
  brand: string
  languageToggle: string
  loading: string
  accessDenied: string
  mapTitle: string
  mapSubtitle: (day: string) => string
  briefingLink: string
  mapLoadError: string
  colRegion: string
  colCountry: string
  colStage: string
  colScore: string
  colTriggers: string
  noScores: string
  close: string
  freeLayer: string
  fragility: string
  population: string
  exposure: (n: string) => string
  briefingLocked: (credits: number) => string
  deepAnalyze: (credits: number) => string
  requesting: string
  deepWait: string
  deepFailed: string
  deepReady: string
  deepCached: string
  deepRequested: string
  notEnoughCredits: string
  limitActive: string
  limitDaily: string
  requestFailed: string
  pulse: string
  briefingTitle: string
  briefingSubtitle: (credits: number) => string
  backToMap: string
  briefingLoadError: string
  noCards: string
  unlock: (credits: number) => string
  unlocking: string
  unlockFailed: string
  noveltyLine: (onlyUs: number, also: number) => string
  none: string
  whatToDo: string
  whyMiss: string
  evidence: string
  showEvidence: string
  hideEvidence: string
  onlyUs: string
  alsoSeenElsewhere: string
  baselineRisks: string
  missedByOthers: string
  headlines: string
  headlineFallback: string
  stageWord: string
  stageBanner: { 1: string; 2: string; 3: string; 4: string; 5: string }
  calmEmpty: string
  possibility: { low: string; medium: string; high: string }
  adminTitle: string
  adminSubtitle: (day: string) => string
  dashboard: string
  runAll: string
  queueing: string
  runAllConfirm: (count: number, usd: string) => string
  worldMap: string
  regions: string
  scoredCount: (n: number) => string
  showTop200: string
  showAll: (n: number) => string
  runAllEstimate: (usd: string, count: number, each: string) => string
  colName: string
  colLastRun: string
  colRun: string
  runEngine: string
  noScoredRegions: string
  queue: string
  queueStatus: { queued: string; running: string; done: string; failed: string }
  allRegions: string
  runResult: string
  published: string
  publishing: string
  publish: string
  publishOk: string
  publishFailed: string
  pickRun: string
  noveltyAdmin: (onlyUs: number, also: number, cost: string) => string
  loadFailed: string
  loadRunFailed: string
  couldNotQueue: string
  today: string
  cost: string
  worldRiskTitle: string
  worldRiskSummary: (act: number, alert: number, watch: number) => string
  worldRiskUpdated: (at: string) => string
  worldRiskStage5: string
  worldRiskStage4: string
  worldRiskStage3: string
  showStage1: string
  hideStage1: string
  dangerNowTitle: string
  dangerNowSubtitle: string
  dangerRegionLine: (triggers: string, fragility: string, people: string) => string
  dangerPeopleUnit: (n: string) => string
  dangerFragilityUnit: (n: number) => string
  lockedInside: (headlines: number, missed: number, baseline: number) => string
  lockedTeaser: string
  emptyTitle: string
  emptyTier1: string
  emptyTier2: string
  emptyTier3: string
  emptySampleLabel: string
  sampleHeadline: string
  sampleSummary: string
  howItWorksTitle: string
  howItWorksLine1: string
  howItWorksLine2: string
  howItWorksLine3: string
  workerWaiting: string
  progressQueued: string
  progressRunning: string
  elapsed: (minutes: number, seconds: number) => string
  stepAnalyst: string
  stepSearch: string
  stepHunter: string
  stepRedTeam: string
  stepJudge: string
  stepDone: string
  stepRunning: string
  stepWaiting: string
  peopleAbout: (n: string) => string
  rainForecast: (sum: number, max: number) => string
  rainForecastShort: (sum: number) => string
  riverPeak: (peak: number) => string
  quakeMag: (mag: number) => string
  fragilityKind: (kind: string) => string
} & HazardUiSlice & {
  zoneAnalyze: (credits: number) => string
  globalAnalyze: (credits: number) => string
  zonePicker: string
  borderLinks: string
  intraRegionLinks: string
  rowAnalyze: string
  rowAnalyzeHint: (credits: number) => string
}

const ko: CrisisUiPack = {
  brand: 'CrisisWatch',
  languageToggle: '언어',
  loading: '불러오는 중…',
  accessDenied: '접근 권한이 없습니다',
  mapTitle: '오늘의 위험 지도',
  mapSubtitle: (day) => `UTC ${day} · 원이 밝을수록 단계가 높습니다`,
  briefingLink: '브리핑 보기',
  mapLoadError: '지도를 불러오지 못했습니다',
  colRegion: '지역',
  colCountry: '국가',
  colStage: '단계',
  colScore: '점수',
  colTriggers: '신호',
  noScores: '오늘 점수 데이터가 없습니다.',
  close: '닫기',
  freeLayer: '무료 요약',
  fragility: '취약 시설',
  population: '인구',
  exposure: (n) => `노출 ${n}`,
  briefingLocked: (credits) => `브리핑 잠김 · ${credits}크레딧`,
  deepAnalyze: (credits) => `이 지역 정밀 분석 · ${credits}크레딧`,
  requesting: '요청 중…',
  deepWait: '분석 중, 최대 15분',
  deepFailed: '분석 실패, 크레딧 환불됨',
  deepReady: '분석이 준비되었습니다.',
  deepCached: '저장된 브리핑을 열었습니다.',
  deepRequested: '요청되었습니다.',
  notEnoughCredits: '크레딧이 부족합니다',
  limitActive: '이미 진행 중인 분석 요청이 있습니다.',
  limitDaily: '하루 최대 3회까지 분석을 요청할 수 있습니다.',
  requestFailed: '요청에 실패했습니다',
  pulse: '깜빡임',
  briefingTitle: '오늘의 공개 브리핑',
  briefingSubtitle: (credits) => `잠긴 카드는 제목만 보입니다. 열기 ${credits}크레딧.`,
  backToMap: '지도로',
  briefingLoadError: '브리핑을 불러오지 못했습니다',
  noCards: '오늘 공개된 카드가 없습니다.',
  unlock: (credits) => `${credits}크레딧으로 열기`,
  unlocking: '여는 중…',
  unlockFailed: '잠금 해제에 실패했습니다',
  noveltyLine: (onlyUs, also) => `보도되지 않은 내용 ${onlyUs} · 이미 보도된 내용 ${also}`,
  none: '없음',
  whatToDo: '지금 할 일',
  whyMiss: '왜 주목해야 하나',
  evidence: '근거',
  showEvidence: '근거 보기',
  hideEvidence: '근거 숨기기',
  onlyUs: '보도되지 않은 내용',
  alsoSeenElsewhere: '이미 보도된 내용',
  baselineRisks: '일반 위험',
  missedByOthers: '추가 경고',
  headlines: '주요 경고',
  headlineFallback: '참고용',
  stageWord: '단계',
  stageBanner: {
    1: '현재 큰 위험 신호 없음',
    2: '관찰',
    3: '주의',
    4: '경계',
    5: '즉시 주의',
  },
  calmEmpty: '현재 큰 위험 신호 없음',
  possibility: { low: '낮음', medium: '보통', high: '높음' },
  adminTitle: 'CRISISWATCH',
  adminSubtitle: (day) => `오늘 ${day} · 점수순 지역 · 엔진 대기열`,
  dashboard: '대시보드',
  runAll: '3단계 이상 전체 실행',
  queueing: '대기열에 넣는 중…',
  runAllConfirm: (count, usd) =>
    `3단계 이상 ${count}개 지역에 엔진을 돌립니다.\n예상 비용: $${usd}`,
  worldMap: '세계 지도',
  regions: '지역',
  scoredCount: (n) => `(점수 0 초과 ${n}곳)`,
  showTop200: '상위 200곳만',
  showAll: (n) => `전체 보기 (${n})`,
  runAllEstimate: (usd, count, each) => `전체 실행 예상 $${usd} (${count} × $${each})`,
  colName: '이름',
  colLastRun: '최근 실행',
  colRun: '실행',
  runEngine: '엔진 실행',
  noScoredRegions: '오늘 점수가 있는 지역이 없습니다.',
  queue: '대기열',
  queueStatus: { queued: '대기', running: '실행 중', done: '완료', failed: '실패' },
  allRegions: '모든 지역',
  runResult: '실행 결과',
  published: '공개됨',
  publishing: '공개 중…',
  publish: '공개',
  publishOk: '카드가 공개되었습니다.',
  publishFailed: '공개에 실패했습니다',
  pickRun: '끝난 대기열 항목을 골라 카드를 확인하세요.',
  noveltyAdmin: (onlyUs, also, cost) =>
    `보도되지 않은 내용 ${onlyUs} · 이미 보도된 내용 ${also} · 비용 $${cost}`,
  loadFailed: '불러오지 못했습니다',
  loadRunFailed: '실행 결과를 불러오지 못했습니다',
  couldNotQueue: '대기열에 넣지 못했습니다',
  today: '오늘',
  cost: '비용',
  worldRiskTitle: '오늘의 세계 위험',
  worldRiskSummary: (act, alert, watch) => `즉시 주의 ${act}곳 · 경계 ${alert}곳 · 주의 ${watch}곳`,
  worldRiskUpdated: (at) => `데이터 ${at} 기준`,
  worldRiskStage5: '즉시 주의',
  worldRiskStage4: '경계',
  worldRiskStage3: '주의',
  dangerNowTitle: '지금 가장 위험한 곳',
  dangerNowSubtitle: '오늘 점수 상위 5개 지역',
  dangerRegionLine: (triggers, fragility, people) => `${triggers} + ${fragility} + ${people}`,
  dangerPeopleUnit: (n) => `인구 ${n}`,
  dangerFragilityUnit: (n) => `취약 시설 ${n}곳`,
  ...HAZARD_UI_KO,
  showStage1: '1단계 표시',
  hideStage1: '1단계 숨김',
  lockedInside: (headlines, missed, baseline) => `주요 경고 ${headlines} · 추가 경고 ${missed} · 일반 위험 ${baseline}`,
  lockedTeaser: '방류 전 고지대로 이동하고, 72시간 식수·연료를 확보하세요.',
  emptyTitle: '오늘의 AI 브리핑 준비 중',
  emptyTier1: '주요 경고 — 지금 당장 대응해야 할 가장 급한 위험',
  emptyTier2: '추가 경고 — 주요 언론·기관이 아직 보지 못한 것',
  emptyTier3: '일반 위험 — 배경에 깔린 구조적 취약점',
  emptySampleLabel: '예시',
  sampleHeadline: '메콩강 상류 댐 방류로 하류 3개 주 홍수 경계',
  sampleSummary: '7일 폭우 예보와 댐 3곳 동시 방류, 저지대 200만 명 노출',
  howItWorksTitle: '이렇게 봅니다',
  howItWorksLine1: '트리거: 폭우·지진·분쟁 같은 즉시 사건',
  howItWorksLine2: '숨은 취약점: 노후 댐, 밀집 저지대, 끊긴 전력망',
  howItWorksLine3: '사람: 그 위에 사는 인구 — 2023년 리비아 데르나는 트리거와 취약점이 겹쳐 11,000명이 사망했습니다',
  workerWaiting: '분석 서버 대기 중',
  progressQueued: '대기열에 있음',
  progressRunning: '분석 중',
  elapsed: (minutes, seconds) => (minutes > 0 ? `${minutes}분 ${seconds}초 경과` : `${seconds}초 경과`),
  stepAnalyst: '분석관',
  stepSearch: '검색',
  stepHunter: '사냥꾼',
  stepRedTeam: '반박',
  stepJudge: '판정',
  stepDone: '완료',
  stepRunning: '진행',
  stepWaiting: '대기',
  peopleAbout: (n) => `인구 약 ${n} 명`,
  rainForecast: (sum, max) => `7일 강수 예보 ${Math.round(sum)}mm, 하루 최대 ${Math.round(max)}mm`,
  rainForecastShort: (sum) => `7일 강수 ${Math.round(sum)}mm 예보`,
  riverPeak: (peak) => `하천 유량 최대 ${Math.round(peak)}㎥/s`,
  quakeMag: (mag) => `지진 규모 ${mag.toFixed(1)}`,
  fragilityKind: (kind) => {
    const map: Record<string, string> = {
      dam: '댐',
      reservoir: '저수지',
      levee: '제방',
      refugee_camp: '난민촌',
      nuclear_plant: '원전',
      power_plant: '발전소',
      glacial_lake: '빙하호',
      hospital: '병원',
      port: '항구',
      site: '시설',
    }
    return map[kind] ?? kind
  },
  zoneAnalyze: (credits) => `구역 분석 · ${credits}크레딧`,
  globalAnalyze: (credits) => `전 세계 분석 · ${credits}크레딧`,
  zonePicker: '구역',
  borderLinks: '국경 연결',
  intraRegionLinks: '지역 간 연결',
  rowAnalyze: '분석',
  rowAnalyzeHint: (credits) => `이 지역 AI 정밀 분석 · ${credits}크레딧, 약 4분`,
}

const en: CrisisUiPack = {
  brand: 'CrisisWatch',
  languageToggle: 'Language',
  loading: 'Loading…',
  accessDenied: 'Access denied',
  mapTitle: 'Today’s risk map',
  mapSubtitle: (day) => `UTC ${day} · brighter circles mean a higher stage`,
  briefingLink: 'Open briefing',
  mapLoadError: 'Could not load the map',
  colRegion: 'Region',
  colCountry: 'Country',
  colStage: 'Stage',
  colScore: 'Score',
  colTriggers: 'Signals',
  noScores: 'No score data for today.',
  close: 'Close',
  freeLayer: 'Free summary',
  fragility: 'Fragile sites',
  population: 'People',
  exposure: (n) => `Exposure ${n}`,
  briefingLocked: (credits) => `Briefing locked · ${credits} credits`,
  deepAnalyze: (credits) => `Deep analysis for this region · ${credits} credits`,
  requesting: 'Requesting…',
  deepWait: 'Analysis running, up to 15 minutes',
  deepFailed: 'Analysis failed, credits refunded',
  deepReady: 'Analysis is ready.',
  deepCached: 'Opened a saved briefing.',
  deepRequested: 'Requested.',
  notEnoughCredits: 'Not enough credits',
  limitActive: 'You already have an analysis in progress.',
  limitDaily: 'You can request analysis up to 3 times a day.',
  requestFailed: 'Request failed',
  pulse: 'pulse',
  briefingTitle: 'Today’s public briefing',
  briefingSubtitle: (credits) => `Locked cards show the title only. Unlock for ${credits} credits.`,
  backToMap: 'Map',
  briefingLoadError: 'Could not load the briefing',
  noCards: 'No public cards today.',
  unlock: (credits) => `Unlock for ${credits} credits`,
  unlocking: 'Unlocking…',
  unlockFailed: 'Could not unlock',
  noveltyLine: (onlyUs, also) => `Not yet reported ${onlyUs} · already reported ${also}`,
  none: 'None',
  whatToDo: 'What to do',
  whyMiss: 'Why this matters',
  evidence: 'Evidence',
  showEvidence: 'Show evidence',
  hideEvidence: 'Hide evidence',
  onlyUs: 'Not yet reported',
  alsoSeenElsewhere: 'Already reported',
  baselineRisks: 'General risks',
  missedByOthers: 'Extra warnings',
  headlines: 'Main warnings',
  headlineFallback: 'For reference',
  stageWord: 'Stage',
  stageBanner: {
    1: 'No major danger signal now',
    2: 'Watch',
    3: 'Caution',
    4: 'Alert',
    5: 'Act now',
  },
  calmEmpty: 'No major danger signal now',
  possibility: { low: 'low', medium: 'medium', high: 'high' },
  adminTitle: 'CRISISWATCH',
  adminSubtitle: (day) => `Today ${day} · regions by score · engine queue`,
  dashboard: 'Dashboard',
  runAll: 'Run all (stage ≥ 3)',
  queueing: 'Queueing…',
  runAllConfirm: (count, usd) =>
    `Run the engine for ${count} region(s) at stage ≥ 3?\nEstimated cost: $${usd}`,
  worldMap: 'World map',
  regions: 'Regions',
  scoredCount: (n) => `(${n} with score > 0)`,
  showTop200: 'Show top 200',
  showAll: (n) => `Show all (${n})`,
  runAllEstimate: (usd, count, each) => `Run-all estimate $${usd} (${count} × $${each})`,
  colName: 'Name',
  colLastRun: 'Last run',
  colRun: 'Run',
  runEngine: 'Run engine',
  noScoredRegions: 'No regions with score > 0 today.',
  queue: 'Queue',
  queueStatus: { queued: 'queued', running: 'running', done: 'done', failed: 'failed' },
  allRegions: 'All regions',
  runResult: 'Run result',
  published: 'Published',
  publishing: 'Publishing…',
  publish: 'Publish',
  publishOk: 'Card is public.',
  publishFailed: 'Publish failed',
  pickRun: 'Pick a finished queue item to inspect the card.',
  noveltyAdmin: (onlyUs, also, cost) =>
    `Not yet reported ${onlyUs} · already reported ${also} · cost $${cost}`,
  loadFailed: 'Failed to load',
  loadRunFailed: 'Failed to load run',
  couldNotQueue: 'Could not queue',
  today: 'Today',
  cost: 'Cost',
  worldRiskTitle: 'Today’s world risk',
  worldRiskSummary: (act, alert, watch) => `Act now ${act} · Alert ${alert} · Watch ${watch}`,
  worldRiskUpdated: (at) => `Data as of ${at}`,
  worldRiskStage5: 'Act now',
  worldRiskStage4: 'Alert',
  worldRiskStage3: 'Watch',
  dangerNowTitle: 'Most dangerous right now',
  dangerNowSubtitle: 'Top 5 regions by today’s score',
  dangerRegionLine: (triggers, fragility, people) => `${triggers} + ${fragility} + ${people}`,
  dangerPeopleUnit: (n) => `${n} people`,
  dangerFragilityUnit: (n) => `${n} fragile sites`,
  ...HAZARD_UI_EN,
  showStage1: 'Show stage 1',
  hideStage1: 'Hide stage 1',
  lockedInside: (headlines, missed, baseline) => `${headlines} main warnings · ${missed} extra · ${baseline} general risks`,
  lockedTeaser: 'Move to higher ground before discharge and secure 72 hours of water and fuel.',
  emptyTitle: 'Today’s AI briefing is being prepared',
  emptyTier1: 'Main warnings — the most urgent dangers to act on now',
  emptyTier2: 'Extra warnings — what major outlets haven’t caught yet',
  emptyTier3: 'General risks — the structural fragility underneath',
  emptySampleLabel: 'Sample',
  sampleHeadline: 'Mekong upstream dam discharge puts three downstream provinces on flood alert',
  sampleSummary: '7-day heavy rain forecast plus three dams discharging at once, 2M people exposed in lowlands',
  howItWorksTitle: 'How to read this',
  howItWorksLine1: 'Trigger: immediate events like heavy rain, earthquakes, conflict',
  howItWorksLine2: 'Hidden fragility: aging dams, crowded lowlands, fragile power grids',
  howItWorksLine3: 'People: the population living on top — Derna, Libya 2023 killed 11,000 when trigger met fragility',
  workerWaiting: 'Waiting for the analysis server',
  progressQueued: 'Queued',
  progressRunning: 'Running',
  elapsed: (minutes, seconds) =>
    minutes > 0 ? `${minutes}m ${seconds}s elapsed` : `${seconds}s elapsed`,
  stepAnalyst: 'Analysts',
  stepSearch: 'Search',
  stepHunter: 'Hunters',
  stepRedTeam: 'Red team',
  stepJudge: 'Judge',
  stepDone: 'done',
  stepRunning: 'running',
  stepWaiting: 'waiting',
  peopleAbout: (n) => `About ${n} people`,
  rainForecast: (sum, max) => `7-day rain forecast ${Math.round(sum)}mm, daily max ${Math.round(max)}mm`,
  rainForecastShort: (sum) => `7-day rain ${Math.round(sum)}mm forecast`,
  riverPeak: (peak) => `Peak river flow ${Math.round(peak)} m³/s`,
  quakeMag: (mag) => `Magnitude ${mag.toFixed(1)}`,
  fragilityKind: (kind) => kind.replace(/_/g, ' '),
  zoneAnalyze: (credits) => `Zone analysis · ${credits} credits`,
  globalAnalyze: (credits) => `Worldwide analysis · ${credits} credits`,
  zonePicker: 'Zone',
  borderLinks: 'Cross-border links',
  intraRegionLinks: 'Within-country links',
  rowAnalyze: 'Analyze',
  rowAnalyzeHint: (credits) => `AI deep analysis for this region · ${credits} credits, about 4 minutes`,
}

const ja: CrisisUiPack = {
  ...en,
  languageToggle: '言語',
  loading: '読み込み中…',
  accessDenied: 'アクセスできません',
  mapTitle: '今日の危険地図',
  mapSubtitle: (day) => `UTC ${day} · 円が明るいほど段階が高い`,
  briefingLink: 'ブリーフィング',
  mapLoadError: '地図を読み込めませんでした',
  colRegion: '地域',
  colCountry: '国',
  colStage: '段階',
  colScore: '点数',
  colTriggers: '信号',
  noScores: '今日の点数データはありません。',
  close: '閉じる',
  freeLayer: '無料要約',
  fragility: '弱い施設',
  population: '人口',
  exposure: (n) => `露出 ${n}`,
  briefingLocked: (credits) => `ブリーフィングはロック · ${credits}クレジット`,
  deepAnalyze: (credits) => `この地域の精密分析 · ${credits}クレジット`,
  requesting: '依頼中…',
  deepWait: '分析中、最大15分',
  deepFailed: '分析失敗、クレジット返金済み',
  deepReady: '分析の準備ができました。',
  deepCached: '保存済みのブリーフィングを開きました。',
  deepRequested: '依頼しました。',
  notEnoughCredits: 'クレジットが足りません',
  limitActive: 'すでに進行中の分析があります。',
  limitDaily: '分析依頼は1日3回までです。',
  requestFailed: '依頼に失敗しました',
  pulse: '点滅',
  briefingTitle: '今日の公開ブリーフィング',
  briefingSubtitle: (credits) => `ロック中は見出しのみ。解除は ${credits}クレジット。`,
  backToMap: '地図',
  briefingLoadError: 'ブリーフィングを読み込めませんでした',
  noCards: '今日の公開カードはありません。',
  unlock: (credits) => `${credits}クレジットで開く`,
  unlocking: '解除中…',
  unlockFailed: '解除に失敗しました',
  noveltyLine: (onlyUs, also) => `当方のみ ${onlyUs} · 他でも報道 ${also}`,
  none: 'なし',
  whatToDo: '今すること',
  whyMiss: '他が見落とす理由',
  evidence: '根拠',
  showEvidence: '根拠を見る',
  hideEvidence: '根拠を隠す',
  onlyUs: '当方のみ捕捉',
  alsoSeenElsewhere: '他でも報道',
  baselineRisks: '既知のリスク',
  missedByOthers: '他が見落とした信号',
  headlines: '主な信号',
  headlineFallback: '参考',
  stageWord: '段階',
  stageBanner: { 1: '今は大きな危険信号なし', 2: '観察', 3: '注意', 4: '警戒', 5: '直ちに注意' },
  calmEmpty: '今は大きな危険信号なし',
  possibility: { low: '低', medium: '中', high: '高' },
  adminSubtitle: (day) => `今日 ${day} · 点数順 · エンジン待ち`,
  dashboard: 'ダッシュボード',
  runAll: '段階3以上を全部実行',
  queueing: '待ちに追加中…',
  runAllConfirm: (count, usd) => `段階3以上の${count}地域でエンジンを回します。\n見込み費用: $${usd}`,
  worldMap: '世界地図',
  regions: '地域',
  scoredCount: (n) => `(点数0超 ${n})`,
  showTop200: '上位200のみ',
  showAll: (n) => `全部見る (${n})`,
  runAllEstimate: (usd, count, each) => `全部実行見込み $${usd} (${count} × $${each})`,
  colName: '名前',
  colLastRun: '前回実行',
  colRun: '実行',
  runEngine: 'エンジン実行',
  noScoredRegions: '今日、点数のある地域はありません。',
  queue: '待ち行列',
  queueStatus: { queued: '待ち', running: '実行中', done: '完了', failed: '失敗' },
  allRegions: '全地域',
  runResult: '実行結果',
  published: '公開済み',
  publishing: '公開中…',
  publish: '公開',
  publishOk: 'カードを公開しました。',
  publishFailed: '公開に失敗しました',
  pickRun: '終わった待ち項目を選んでカードを見てください。',
  noveltyAdmin: (onlyUs, also, cost) => `当方のみ ${onlyUs} · 他でも報道 ${also} · 費用 $${cost}`,
  loadFailed: '読み込めませんでした',
  loadRunFailed: '実行結果を読み込めませんでした',
  couldNotQueue: '待ちに入れませんでした',
  today: '今日',
  cost: '費用',
}

const zhTW: CrisisUiPack = {
  ...en,
  languageToggle: '語言',
  loading: '載入中…',
  accessDenied: '沒有權限',
  mapTitle: '今日風險地圖',
  mapSubtitle: (day) => `UTC ${day} · 圓越亮階段越高`,
  briefingLink: '看簡報',
  mapLoadError: '無法載入地圖',
  colRegion: '地區',
  colCountry: '國家',
  colStage: '階段',
  colScore: '分數',
  colTriggers: '訊號',
  noScores: '今天沒有分數資料。',
  close: '關閉',
  freeLayer: '免費摘要',
  fragility: '脆弱設施',
  population: '人口',
  exposure: (n) => `曝露 ${n}`,
  briefingLocked: (credits) => `簡報已鎖定 · ${credits}點`,
  deepAnalyze: (credits) => `這個地區的精密分析 · ${credits}點`,
  requesting: '送出中…',
  deepWait: '分析中，最多15分鐘',
  deepFailed: '分析失敗，點數已退回',
  deepReady: '分析已準備好。',
  deepCached: '已打開儲存的簡報。',
  deepRequested: '已送出。',
  notEnoughCredits: '點數不足',
  limitActive: '已有進行中的分析。',
  limitDaily: '每天最多可請求分析3次。',
  requestFailed: '請求失敗',
  pulse: '閃爍',
  briefingTitle: '今日公開簡報',
  briefingSubtitle: (credits) => `鎖定卡片只顯示標題。解鎖 ${credits}點。`,
  backToMap: '地圖',
  briefingLoadError: '無法載入簡報',
  noCards: '今天沒有公開卡片。',
  unlock: (credits) => `用 ${credits}點打開`,
  unlocking: '解鎖中…',
  unlockFailed: '解鎖失敗',
  noveltyLine: (onlyUs, also) => `只有我們抓到 ${onlyUs} · 別處也報導 ${also}`,
  none: '無',
  whatToDo: '現在要做的事',
  whyMiss: '別人為什麼錯過',
  evidence: '依據',
  showEvidence: '看依據',
  hideEvidence: '收起依據',
  onlyUs: '只有我們抓到',
  alsoSeenElsewhere: '別處也報導',
  baselineRisks: '已知風險',
  missedByOthers: '別人錯過的訊號',
  headlines: '主要訊號',
  headlineFallback: '參考用',
  stageWord: '階段',
  stageBanner: { 1: '目前沒有重大危險訊號', 2: '觀察', 3: '注意', 4: '警戒', 5: '立刻注意' },
  calmEmpty: '目前沒有重大危險訊號',
  possibility: { low: '低', medium: '中', high: '高' },
  adminSubtitle: (day) => `今天 ${day} · 依分數排序 · 引擎佇列`,
  dashboard: '控制台',
  runAll: '執行階段3以上全部',
  queueing: '加入佇列中…',
  runAllConfirm: (count, usd) => `要對階段3以上的 ${count} 個地區跑引擎嗎？\n預估費用：$${usd}`,
  worldMap: '世界地圖',
  regions: '地區',
  scoredCount: (n) => `(分數大於0：${n})`,
  showTop200: '只看前200',
  showAll: (n) => `看全部 (${n})`,
  runAllEstimate: (usd, count, each) => `全部執行預估 $${usd} (${count} × $${each})`,
  colName: '名稱',
  colLastRun: '上次執行',
  colRun: '執行',
  runEngine: '跑引擎',
  noScoredRegions: '今天沒有分數大於0的地區。',
  queue: '佇列',
  queueStatus: { queued: '等待', running: '執行中', done: '完成', failed: '失敗' },
  allRegions: '全部地區',
  runResult: '執行結果',
  published: '已公開',
  publishing: '公開中…',
  publish: '公開',
  publishOk: '卡片已公開。',
  publishFailed: '公開失敗',
  pickRun: '選一個已完成的佇列項目來看卡片。',
  noveltyAdmin: (onlyUs, also, cost) => `只有我們抓到 ${onlyUs} · 別處也報導 ${also} · 費用 $${cost}`,
  loadFailed: '載入失敗',
  loadRunFailed: '無法載入執行結果',
  couldNotQueue: '無法加入佇列',
  today: '今天',
  cost: '費用',
}

const fr: CrisisUiPack = {
  ...en,
  languageToggle: 'Langue',
  loading: 'Chargement…',
  accessDenied: 'Accès refusé',
  mapTitle: 'Carte des risques du jour',
  mapSubtitle: (day) => `UTC ${day} · plus le cercle est clair, plus le niveau est haut`,
  briefingLink: 'Voir le briefing',
  mapLoadError: 'Impossible de charger la carte',
  colRegion: 'Région',
  colCountry: 'Pays',
  colStage: 'Niveau',
  colScore: 'Score',
  colTriggers: 'Signaux',
  noScores: 'Pas de scores aujourd’hui.',
  close: 'Fermer',
  freeLayer: 'Résumé gratuit',
  fragility: 'Sites fragiles',
  population: 'Population',
  exposure: (n) => `Exposition ${n}`,
  briefingLocked: (credits) => `Briefing verrouillé · ${credits} crédits`,
  deepAnalyze: (credits) => `Analyse précise de cette région · ${credits} crédits`,
  requesting: 'Demande…',
  deepWait: 'Analyse en cours, jusqu’à 15 minutes',
  deepFailed: 'Analyse échouée, crédits remboursés',
  deepReady: 'L’analyse est prête.',
  deepCached: 'Briefing enregistré ouvert.',
  deepRequested: 'Demande envoyée.',
  notEnoughCredits: 'Pas assez de crédits',
  limitActive: 'Une analyse est déjà en cours.',
  limitDaily: 'Vous pouvez demander une analyse 3 fois par jour.',
  requestFailed: 'Échec de la demande',
  pulse: 'pulse',
  briefingTitle: 'Briefing public du jour',
  briefingSubtitle: (credits) => `Les cartes verrouillées n’affichent que le titre. Déverrouiller : ${credits} crédits.`,
  backToMap: 'Carte',
  briefingLoadError: 'Impossible de charger le briefing',
  noCards: 'Aucune carte publique aujourd’hui.',
  unlock: (credits) => `Ouvrir pour ${credits} crédits`,
  unlocking: 'Ouverture…',
  unlockFailed: 'Impossible de déverrouiller',
  noveltyLine: (onlyUs, also) => `Nous seuls ${onlyUs} · aussi vu ailleurs ${also}`,
  none: 'Aucun',
  whatToDo: 'Que faire',
  whyMiss: 'Pourquoi les autres le manquent',
  evidence: 'Preuves',
  showEvidence: 'Voir les preuves',
  hideEvidence: 'Cacher les preuves',
  onlyUs: 'Nous seuls l’avons vu',
  alsoSeenElsewhere: 'Aussi vu ailleurs',
  baselineRisks: 'Risques connus',
  missedByOthers: 'Signaux manqués par les autres',
  headlines: 'Signaux clés',
  headlineFallback: 'Pour référence',
  stageWord: 'Niveau',
  stageBanner: { 1: 'Pas de grand signal de danger', 2: 'Observation', 3: 'Vigilance', 4: 'Alerte', 5: 'Attention immédiate' },
  calmEmpty: 'Pas de grand signal de danger',
  possibility: { low: 'faible', medium: 'moyenne', high: 'haute' },
  adminSubtitle: (day) => `Aujourd’hui ${day} · régions par score · file moteur`,
  dashboard: 'Tableau de bord',
  runAll: 'Lancer tout (niveau ≥ 3)',
  queueing: 'Mise en file…',
  runAllConfirm: (count, usd) => `Lancer le moteur pour ${count} région(s) au niveau ≥ 3 ?\nCoût estimé : $${usd}`,
  worldMap: 'Carte du monde',
  regions: 'Régions',
  scoredCount: (n) => `(${n} avec score > 0)`,
  showTop200: 'Voir le top 200',
  showAll: (n) => `Tout voir (${n})`,
  runAllEstimate: (usd, count, each) => `Estimation tout lancer $${usd} (${count} × $${each})`,
  colName: 'Nom',
  colLastRun: 'Dernier run',
  colRun: 'Lancer',
  runEngine: 'Lancer le moteur',
  noScoredRegions: 'Aucune région avec un score > 0 aujourd’hui.',
  queue: 'File',
  queueStatus: { queued: 'en attente', running: 'en cours', done: 'terminé', failed: 'échec' },
  allRegions: 'Toutes les régions',
  runResult: 'Résultat',
  published: 'Publié',
  publishing: 'Publication…',
  publish: 'Publier',
  publishOk: 'La carte est publique.',
  publishFailed: 'Échec de la publication',
  pickRun: 'Choisissez un élément terminé pour voir la carte.',
  noveltyAdmin: (onlyUs, also, cost) => `Nous seuls ${onlyUs} · aussi vu ailleurs ${also} · coût $${cost}`,
  loadFailed: 'Échec du chargement',
  loadRunFailed: 'Impossible de charger le run',
  couldNotQueue: 'Impossible de mettre en file',
  today: 'Aujourd’hui',
  cost: 'Coût',
}

const es: CrisisUiPack = {
  ...en,
  languageToggle: 'Idioma',
  loading: 'Cargando…',
  accessDenied: 'Acceso denegado',
  mapTitle: 'Mapa de riesgo de hoy',
  mapSubtitle: (day) => `UTC ${day} · un círculo más claro es un nivel más alto`,
  briefingLink: 'Ver informe',
  mapLoadError: 'No se pudo cargar el mapa',
  colRegion: 'Región',
  colCountry: 'País',
  colStage: 'Nivel',
  colScore: 'Puntos',
  colTriggers: 'Señales',
  noScores: 'No hay datos de puntos hoy.',
  close: 'Cerrar',
  freeLayer: 'Resumen gratis',
  fragility: 'Sitios frágiles',
  population: 'Población',
  exposure: (n) => `Exposición ${n}`,
  briefingLocked: (credits) => `Informe bloqueado · ${credits} créditos`,
  deepAnalyze: (credits) => `Análisis preciso de esta región · ${credits} créditos`,
  requesting: 'Enviando…',
  deepWait: 'Análisis en curso, hasta 15 minutos',
  deepFailed: 'El análisis falló, créditos devueltos',
  deepReady: 'El análisis está listo.',
  deepCached: 'Se abrió un informe guardado.',
  deepRequested: 'Solicitud enviada.',
  notEnoughCredits: 'No hay créditos suficientes',
  limitActive: 'Ya tienes un análisis en curso.',
  limitDaily: 'Puedes pedir análisis hasta 3 veces al día.',
  requestFailed: 'La solicitud falló',
  pulse: 'pulso',
  briefingTitle: 'Informe público de hoy',
  briefingSubtitle: (credits) => `Las tarjetas bloqueadas solo muestran el título. Abrir: ${credits} créditos.`,
  backToMap: 'Mapa',
  briefingLoadError: 'No se pudo cargar el informe',
  noCards: 'No hay tarjetas públicas hoy.',
  unlock: (credits) => `Abrir por ${credits} créditos`,
  unlocking: 'Abriendo…',
  unlockFailed: 'No se pudo abrir',
  noveltyLine: (onlyUs, also) => `Solo nosotros ${onlyUs} · también en otros ${also}`,
  none: 'Ninguno',
  whatToDo: 'Qué hacer',
  whyMiss: 'Por qué otros lo pierden',
  evidence: 'Pruebas',
  showEvidence: 'Ver pruebas',
  hideEvidence: 'Ocultar pruebas',
  onlyUs: 'Solo nosotros lo vimos',
  alsoSeenElsewhere: 'También en otros medios',
  baselineRisks: 'Riesgos conocidos',
  missedByOthers: 'Señales que otros no vieron',
  headlines: 'Señales clave',
  headlineFallback: 'De referencia',
  stageWord: 'Nivel',
  stageBanner: { 1: 'Ahora no hay una señal de gran peligro', 2: 'Observación', 3: 'Atención', 4: 'Alerta', 5: 'Atención inmediata' },
  calmEmpty: 'Ahora no hay una señal de gran peligro',
  possibility: { low: 'baja', medium: 'media', high: 'alta' },
  adminSubtitle: (day) => `Hoy ${day} · regiones por puntos · cola del motor`,
  dashboard: 'Panel',
  runAll: 'Ejecutar todo (nivel ≥ 3)',
  queueing: 'En cola…',
  runAllConfirm: (count, usd) => `¿Ejecutar el motor en ${count} región(es) de nivel ≥ 3?\nCosto estimado: $${usd}`,
  worldMap: 'Mapa mundial',
  regions: 'Regiones',
  scoredCount: (n) => `(${n} con puntos > 0)`,
  showTop200: 'Ver las 200 primeras',
  showAll: (n) => `Ver todas (${n})`,
  runAllEstimate: (usd, count, each) => `Estimación de todo $${usd} (${count} × $${each})`,
  colName: 'Nombre',
  colLastRun: 'Última ejecución',
  colRun: 'Ejecutar',
  runEngine: 'Ejecutar motor',
  noScoredRegions: 'Hoy no hay regiones con puntos > 0.',
  queue: 'Cola',
  queueStatus: { queued: 'en cola', running: 'en curso', done: 'hecho', failed: 'falló' },
  allRegions: 'Todas las regiones',
  runResult: 'Resultado',
  published: 'Publicado',
  publishing: 'Publicando…',
  publish: 'Publicar',
  publishOk: 'La tarjeta es pública.',
  publishFailed: 'No se pudo publicar',
  pickRun: 'Elige un ítem terminado para ver la tarjeta.',
  noveltyAdmin: (onlyUs, also, cost) => `Solo nosotros ${onlyUs} · también en otros ${also} · costo $${cost}`,
  loadFailed: 'No se pudo cargar',
  loadRunFailed: 'No se pudo cargar el resultado',
  couldNotQueue: 'No se pudo poner en cola',
  today: 'Hoy',
  cost: 'Costo',
}

const ar: CrisisUiPack = {
  ...en,
  languageToggle: 'اللغة',
  loading: 'جارٍ التحميل…',
  accessDenied: 'لا يوجد إذن',
  mapTitle: 'خريطة الخطر اليوم',
  mapSubtitle: (day) => `UTC ${day} · الدائرة الأسطع تعني مرحلة أعلى`,
  briefingLink: 'عرض الإحاطة',
  mapLoadError: 'تعذر تحميل الخريطة',
  colRegion: 'المنطقة',
  colCountry: 'البلد',
  colStage: 'المرحلة',
  colScore: 'النقاط',
  colTriggers: 'إشارات',
  noScores: 'لا توجد نقاط اليوم.',
  close: 'إغلاق',
  freeLayer: 'ملخص مجاني',
  fragility: 'مواقع هشة',
  population: 'السكان',
  exposure: (n) => `تعرض ${n}`,
  briefingLocked: (credits) => `الإحاطة مقفلة · ${credits} رصيد`,
  deepAnalyze: (credits) => `تحليل دقيق لهذه المنطقة · ${credits} رصيد`,
  requesting: 'جارٍ الطلب…',
  deepWait: 'التحليل جارٍ، حتى 15 دقيقة',
  deepFailed: 'فشل التحليل، أُعيد الرصيد',
  deepReady: 'التحليل جاهز.',
  deepCached: 'فُتحت إحاطة محفوظة.',
  deepRequested: 'تم الطلب.',
  notEnoughCredits: 'الرصيد غير كافٍ',
  limitActive: 'لديك تحليل قيد التنفيذ.',
  limitDaily: 'يمكنك طلب التحليل حتى 3 مرات في اليوم.',
  requestFailed: 'فشل الطلب',
  pulse: 'وميض',
  briefingTitle: 'الإحاطة العامة اليوم',
  briefingSubtitle: (credits) => `البطاقات المقفلة تعرض العنوان فقط. الفتح ${credits} رصيد.`,
  backToMap: 'الخريطة',
  briefingLoadError: 'تعذر تحميل الإحاطة',
  noCards: 'لا توجد بطاقات عامة اليوم.',
  unlock: (credits) => `افتح بـ ${credits} رصيد`,
  unlocking: 'جارٍ الفتح…',
  unlockFailed: 'تعذر الفتح',
  noveltyLine: (onlyUs, also) => `نحن فقط ${onlyUs} · نُشر أيضاً ${also}`,
  none: 'لا شيء',
  whatToDo: 'ماذا تفعل',
  whyMiss: 'لماذا يفوتها الآخرون',
  evidence: 'أدلة',
  showEvidence: 'إظهار الأدلة',
  hideEvidence: 'إخفاء الأدلة',
  onlyUs: 'رصدناه وحدنا',
  alsoSeenElsewhere: 'نُشر في أماكن أخرى',
  baselineRisks: 'مخاطر معروفة',
  missedByOthers: 'إشارات فاتت الآخرين',
  headlines: 'إشارات أساسية',
  headlineFallback: 'للمرجع',
  stageWord: 'المرحلة',
  stageBanner: { 1: 'لا توجد إشارة خطر كبيرة الآن', 2: 'رصد', 3: 'انتباه', 4: 'تأهب', 5: 'انتباه فوري' },
  calmEmpty: 'لا توجد إشارة خطر كبيرة الآن',
  possibility: { low: 'منخفض', medium: 'متوسط', high: 'عالٍ' },
  adminSubtitle: (day) => `اليوم ${day} · المناطق حسب النقاط · طابور المحرك`,
  dashboard: 'لوحة التحكم',
  runAll: 'تشغيل الكل (مرحلة ≥ 3)',
  queueing: 'إلى الطابور…',
  runAllConfirm: (count, usd) => `تشغيل المحرك لـ ${count} منطقة في مرحلة ≥ 3؟\nالتكلفة المتوقعة: $${usd}`,
  worldMap: 'خريطة العالم',
  regions: 'المناطق',
  scoredCount: (n) => `(${n} بنقاط > 0)`,
  showTop200: 'أعلى 200 فقط',
  showAll: (n) => `عرض الكل (${n})`,
  runAllEstimate: (usd, count, each) => `تقدير تشغيل الكل $${usd} (${count} × $${each})`,
  colName: 'الاسم',
  colLastRun: 'آخر تشغيل',
  colRun: 'تشغيل',
  runEngine: 'تشغيل المحرك',
  noScoredRegions: 'لا توجد مناطق بنقاط > 0 اليوم.',
  queue: 'الطابور',
  queueStatus: { queued: 'انتظار', running: 'يعمل', done: 'تم', failed: 'فشل' },
  allRegions: 'كل المناطق',
  runResult: 'نتيجة التشغيل',
  published: 'منشور',
  publishing: 'جارٍ النشر…',
  publish: 'نشر',
  publishOk: 'البطاقة أصبحت عامة.',
  publishFailed: 'فشل النشر',
  pickRun: 'اختر عنصراً منتهياً لعرض البطاقة.',
  noveltyAdmin: (onlyUs, also, cost) => `نحن فقط ${onlyUs} · نُشر أيضاً ${also} · التكلفة $${cost}`,
  loadFailed: 'تعذر التحميل',
  loadRunFailed: 'تعذر تحميل نتيجة التشغيل',
  couldNotQueue: 'تعذر الإضافة إلى الطابور',
  today: 'اليوم',
  cost: 'التكلفة',
}

export const CRISIS_UI: Record<CrisisLocale, CrisisUiPack> = {
  ko,
  en,
  ja,
  'zh-TW': zhTW,
  fr,
  ar,
  es,
  pt: en,
}

export function getCrisisUiPack(locale: CrisisLocale): CrisisUiPack {
  return CRISIS_UI[locale] ?? CRISIS_UI.en
}

export function noveltyLabel(novelty: string | undefined, t: CrisisUiPack): string | null {
  if (novelty === 'only_us') return t.onlyUs
  if (novelty === 'also_seen_elsewhere') return t.alsoSeenElsewhere
  return null
}

export { getOutcomeUi } from './outcomes'

export function stageBannerText(stage: number, t: CrisisUiPack): string {
  if (stage >= 5) return t.stageBanner[5]
  if (stage >= 4) return t.stageBanner[4]
  if (stage >= 3) return t.stageBanner[3]
  if (stage >= 2) return t.stageBanner[2]
  return t.calmEmpty
}
