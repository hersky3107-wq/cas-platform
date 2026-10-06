/**
 * Copy for the leaderboard boards, in every league locale. Camp, tier, method
 * and weights labels, table columns and horizons come from the main UI pack;
 * extra-seat names come from `lib/league/boards/extra-copy.ts`.
 */
import type { BoardPeriod } from '../boards/types'
import type { LeagueLocale } from './locales'

export type BoardTab = 'battle' | 'models' | 'fields' | 'companies' | 'lenses' | 'extras' | 'fame'

export const BOARD_TABS: readonly BoardTab[] = ['battle', 'models', 'fields', 'companies', 'lenses', 'extras', 'fame']

export type LeaderboardBoardCopy = {
  bannerTitle: string
  rateRounds: (pct: string, rounds: number) => string
  ratePooled: (pct: string, rounds: number, calls: number) => string
  insufficient: (n: number) => string
  noData: string
  coinFlip: string
  expand: string
  collapse: string
  byCategory: string
  byHorizon: string
  pending: string
  scopeLine: (rounds: number) => string
  minSampleNote: (min: number) => string
  loading: string
  filters: {
    door: string
    category: string
    horizon: string
    period: string
    all: string
    doors: { finance: string; world: string; all: string }
    periods: Record<BoardPeriod, string>
  }
  todayTitle: string
  highlights: {
    camp: string
    divination: (name: string) => string
    siblings: (company: string) => string
    method: string
  }
  ai: string
  tabs: Record<BoardTab, string>
  battle: {
    camp: string
    tier: string
    book: string
    weights: string
    tierNote: string
    pooledNote: string
    agreementTitle: string
    share: string
    confidence: string
    shareBuckets: { '85+': string; '70-84': string; '<70': string }
    confidenceBuckets: { '80+': string; '70-79': string; '60-69': string; '<60': string }
  }
  models: { official: string; extras: string }
  fields: { top: string; bottom: string; showAll: string; hideAll: string; ranked: (n: number) => string; noRanked: string }
  companies: { totals: string; siblings: string; models: (n: number) => string }
  lenses: { title: string; note: string; withoutLens: (n: number) => string }
  extras: {
    pooled: string
    extrasLabel: string
    ai40Label: string
    pooledNote: string
    h2h: string
    together: (rounds: number) => string
    crowLine: (contrarian: number, right: number) => string
    crowAnswered: (n: number) => string
    replay: string
    replayEmpty: string
  }
  fame: {
    current: string
    longest: string
    streak: (n: number) => string
    loneWolf: string
    loneWolfNote: (maxSeats: number) => string
    times: (n: number) => string
    bluff: string
    bluffNote: (minConfidence: number) => string
    bluffLine: (hits: number, n: number) => string
    humble: string
    humbleNote: (maxConfidence: number) => string
    humbleLine: (hits: number, n: number) => string
    empty: string
    insufficientModels: (n: number) => string
  }
  /** Ledger categories with no public catalog chip. */
  categories: { ai_models: string; crypto_perps: string; bond_rate: string; macro_econ: string; futures_derivatives: string }
}

const ko: LeaderboardBoardCopy = {
  bannerTitle: 'AI 종합 적중률',
  rateRounds: (pct, n) => `${pct}% (${n}판)`,
  ratePooled: (pct, rounds, calls) => `${pct}% (${rounds}판 · ${calls}건)`,
  insufficient: (n) => `표본 부족 (${n})`,
  noData: '기록 없음',
  coinFlip: '동전 던지기 50%',
  expand: '분야·기간별 보기',
  collapse: '접기',
  byCategory: '분야별',
  byHorizon: '예측 기간별',
  pending: '첫 집계를 준비하고 있습니다. 채점이 끝나면 여기에 표시됩니다.',
  scopeLine: (n) => `채점 완료 ${n}판 기준 · 테스트·무효 판 제외`,
  minSampleNote: (min) => `${min}판 미만은 퍼센트와 순위 대신 ‘표본 부족 (n)’으로 표시합니다.`,
  loading: '불러오는 중…',
  filters: {
    door: '구분',
    category: '분야',
    horizon: '예측 기간',
    period: '집계 기간',
    all: '전체',
    doors: { finance: '금융', world: '이슈', all: '전체' },
    periods: { week: '이번 주', month: '이번 달', '90d': '최근 90일', all: '전체' },
  },
  todayTitle: '오늘의 대결',
  highlights: {
    camp: '미국 vs 중국',
    divination: (name) => `${name} vs AI`,
    siblings: (company) => `형제 대결 · ${company}`,
    method: '자체추론 vs 웹검색',
  },
  ai: 'AI 종합',
  tabs: { battle: '대결', models: '모델 순위', fields: '분야별', companies: '회사·형제', lenses: '관점', extras: '엑스트라', fame: '명예의 전당' },
  battle: {
    camp: '진영',
    tier: '티어',
    book: '자체추론 vs 웹검색',
    weights: '폐쇄형 vs 오픈웨이트',
    tierNote: 'PREMIER·CHALLENGER·WORLD는 같은 리서치 패킷을 받습니다 — 같은 입력, 다른 판단.',
    pooledNote: '판 = 채점된 판 수 · 건 = 좌석별 예측을 모두 더한 수',
    agreementTitle: '합의 수준별 AI 종합 기록',
    share: '다수 쪽 비율',
    confidence: '가중 확신도',
    shareBuckets: { '85+': '85% 이상', '70-84': '70–84%', '<70': '70% 미만' },
    confidenceBuckets: { '80+': '80 이상', '70-79': '70–79', '60-69': '60–69', '<60': '60 미만' },
  },
  models: { official: '40 AI 순위 (공식 + 스카우트)', extras: '엑스트라 (별도 집계)' },
  fields: {
    top: '상위 5',
    bottom: '하위 5',
    showAll: '전체 순위 보기',
    hideAll: '접기',
    ranked: (n) => `순위 ${n}개 모델`,
    noRanked: '아직 순위를 매길 만큼 채점된 모델이 없습니다.',
  },
  companies: { totals: '회사별 합계', siblings: '형제 대결', models: (n) => `${n}개 모델` },
  lenses: {
    title: '분석 관점별 적중률',
    note: '관점은 좌석마다 판별로 돌아가는 출발 질문입니다. 한 판에서 여러 좌석이 같은 관점을 받을 수 있습니다.',
    withoutLens: (n) => `관점 도입 전 예측 ${n}건은 제외`,
  },
  extras: {
    pooled: '엑스트라 vs 40 AI (누적)',
    extrasLabel: '엑스트라',
    ai40Label: '40 AI',
    pooledNote: '엑스트라가 답한 판만 비교합니다.',
    h2h: '엑스트라 vs AI 종합',
    together: (n) => `함께 답한 ${n}판`,
    crowLine: (c, r) => `다수와 반대로 간 ${c}번 중 ${r}번 적중`,
    crowAnswered: (n) => `채점된 답 ${n}건`,
    replay: '복기 학습 곡선 (월별)',
    replayEmpty: '아직 채점된 복기 답이 없습니다.',
  },
  fame: {
    current: '현재 연속 적중',
    longest: '역대 최장 연속 적중',
    streak: (n) => `${n}연속`,
    loneWolf: '외로운 늑대',
    loneWolfNote: (max) => `자기 쪽이 ${max}석 이하인 소수파로 맞힌 횟수`,
    times: (n) => `${n}회`,
    bluff: '허풍 순위',
    bluffNote: (min) => `확신 ${min}% 이상으로 틀린 횟수`,
    bluffLine: (h, n) => `${h}번 틀림 · 고확신 ${n}건`,
    humble: '겸손 순위',
    humbleNote: (max) => `확신 ${max}% 이하로 맞힌 횟수`,
    humbleLine: (h, n) => `${h}번 적중 · 저확신 ${n}건`,
    empty: '아직 기록이 없습니다.',
    insufficientModels: (n) => `표본 부족 ${n}개 모델`,
  },
  categories: { ai_models: 'AI 순위', crypto_perps: '코인 선물', bond_rate: '금리·채권', macro_econ: '거시경제', futures_derivatives: '선물·파생' },
}

const en: LeaderboardBoardCopy = {
  bannerTitle: 'AI consensus hit rate',
  rateRounds: (pct, n) => `${pct}% (${n} rounds)`,
  ratePooled: (pct, rounds, calls) => `${pct}% (${rounds} rounds · ${calls} calls)`,
  insufficient: (n) => `Sample too small (${n})`,
  noData: 'No record',
  coinFlip: 'Coin flip 50%',
  expand: 'By field and horizon',
  collapse: 'Hide',
  byCategory: 'By field',
  byHorizon: 'By horizon',
  pending: 'The first tally is being prepared. Boards appear here once grading has run.',
  scopeLine: (n) => `Based on ${n} graded rounds · test and voided rounds excluded`,
  minSampleNote: (min) => `Under ${min} rounds, a figure shows “Sample too small (n)” instead of a percentage or rank.`,
  loading: 'Loading…',
  filters: {
    door: 'Board',
    category: 'Field',
    horizon: 'Horizon',
    period: 'Period',
    all: 'All',
    doors: { finance: 'Finance', world: 'Issues', all: 'All' },
    periods: { week: 'This week', month: 'This month', '90d': 'Last 90 days', all: 'All time' },
  },
  todayTitle: 'Today’s matchups',
  highlights: {
    camp: 'US vs China',
    divination: (name) => `${name} vs AI`,
    siblings: (company) => `Sibling battle · ${company}`,
    method: 'Own reasoning vs web search',
  },
  ai: 'AI consensus',
  tabs: { battle: 'Matchups', models: 'Models', fields: 'By field', companies: 'Companies', lenses: 'Lenses', extras: 'Extras', fame: 'Hall of fame' },
  battle: {
    camp: 'Camps',
    tier: 'Tiers',
    book: 'Own reasoning vs web search',
    weights: 'Closed vs open weights',
    tierNote: 'PREMIER, CHALLENGER and WORLD get the same research packet — same inputs, different judgment.',
    pooledNote: 'rounds = graded rounds · calls = every seat’s prediction added up',
    agreementTitle: 'AI consensus by agreement level',
    share: 'Majority share',
    confidence: 'Weighted confidence',
    shareBuckets: { '85+': '85% or more', '70-84': '70–84%', '<70': 'Under 70%' },
    confidenceBuckets: { '80+': '80+', '70-79': '70–79', '60-69': '60–69', '<60': 'Under 60' },
  },
  models: { official: 'The 40 AIs (official + scout)', extras: 'Extras (scored separately)' },
  fields: {
    top: 'Top 5',
    bottom: 'Bottom 5',
    showAll: 'Full ranking',
    hideAll: 'Hide',
    ranked: (n) => `${n} models ranked`,
    noRanked: 'No model has enough graded rounds to rank yet.',
  },
  companies: { totals: 'Company totals', siblings: 'Sibling battles', models: (n) => `${n} models` },
  lenses: {
    title: 'Hit rate by analysis lens',
    note: 'A lens is the starting question each seat gets, rotated every round. Several seats can share a lens in one round.',
    withoutLens: (n) => `${n} calls from before lenses are left out`,
  },
  extras: {
    pooled: 'Extras vs 40 AIs (cumulative)',
    extrasLabel: 'Extras',
    ai40Label: '40 AIs',
    pooledNote: 'Only rounds where an extra answered.',
    h2h: 'Extras vs AI consensus',
    together: (n) => `${n} rounds answered together`,
    crowLine: (c, r) => `Went against the majority ${c} times, right ${r}`,
    crowAnswered: (n) => `${n} graded answers`,
    replay: 'Review learning curve (monthly)',
    replayEmpty: 'No graded Review answers yet.',
  },
  fame: {
    current: 'Current streaks',
    longest: 'Longest streaks',
    streak: (n) => `${n} in a row`,
    loneWolf: 'Lone wolf',
    loneWolfNote: (max) => `Right while on a side of ${max} seats or fewer, in the minority`,
    times: (n) => `${n}×`,
    bluff: 'Bluff ranking',
    bluffNote: (min) => `Wrong at ${min}% confidence or more`,
    bluffLine: (h, n) => `${h} wrong · ${n} confident calls`,
    humble: 'Humble ranking',
    humbleNote: (max) => `Right at ${max}% confidence or less`,
    humbleLine: (h, n) => `${h} right · ${n} low-confidence calls`,
    empty: 'No record yet.',
    insufficientModels: (n) => `${n} models: sample too small`,
  },
  categories: { ai_models: 'AI rankings', crypto_perps: 'Crypto perps', bond_rate: 'Rates & bonds', macro_econ: 'Macro', futures_derivatives: 'Futures' },
}

const ja: LeaderboardBoardCopy = {
  bannerTitle: 'AI総合の的中率',
  rateRounds: (pct, n) => `${pct}%（${n}回）`,
  ratePooled: (pct, rounds, calls) => `${pct}%（${rounds}回 · ${calls}件）`,
  insufficient: (n) => `サンプル不足（${n}）`,
  noData: '記録なし',
  coinFlip: 'コイン投げ 50%',
  expand: '分野・期間別に見る',
  collapse: '閉じる',
  byCategory: '分野別',
  byHorizon: '予測期間別',
  pending: '最初の集計を準備中です。採点が終わるとここに表示されます。',
  scopeLine: (n) => `採点済み${n}回に基づく · テスト・無効の回は除外`,
  minSampleNote: (min) => `${min}回未満はパーセントや順位の代わりに「サンプル不足（n）」と表示します。`,
  loading: '読み込み中…',
  filters: {
    door: '区分',
    category: '分野',
    horizon: '予測期間',
    period: '集計期間',
    all: 'すべて',
    doors: { finance: '金融', world: '話題', all: 'すべて' },
    periods: { week: '今週', month: '今月', '90d': '直近90日', all: '全期間' },
  },
  todayTitle: '今日の対決',
  highlights: {
    camp: '米国 vs 中国',
    divination: (name) => `${name} vs AI`,
    siblings: (company) => `兄弟対決 · ${company}`,
    method: '自力推論 vs ウェブ検索',
  },
  ai: 'AI総合',
  tabs: { battle: '対決', models: 'モデル順位', fields: '分野別', companies: '企業・兄弟', lenses: '視点', extras: 'エクストラ', fame: '殿堂' },
  battle: {
    camp: '陣営',
    tier: 'ティア',
    book: '自力推論 vs ウェブ検索',
    weights: 'クローズド vs オープンウェイト',
    tierNote: 'PREMIER・CHALLENGER・WORLDは同じリサーチパケットを受け取ります — 同じ入力、異なる判断。',
    pooledNote: '回 = 採点済みの回数 · 件 = 各席の予測の合計',
    agreementTitle: '合意度別のAI総合の記録',
    share: '多数派の割合',
    confidence: '加重確信度',
    shareBuckets: { '85+': '85%以上', '70-84': '70–84%', '<70': '70%未満' },
    confidenceBuckets: { '80+': '80以上', '70-79': '70–79', '60-69': '60–69', '<60': '60未満' },
  },
  models: { official: '40 AI 順位（公式＋スカウト）', extras: 'エクストラ（別集計）' },
  fields: {
    top: '上位5',
    bottom: '下位5',
    showAll: '全順位を見る',
    hideAll: '閉じる',
    ranked: (n) => `順位付き ${n}モデル`,
    noRanked: 'まだ順位を付けられるほど採点されたモデルがありません。',
  },
  companies: { totals: '企業別合計', siblings: '兄弟対決', models: (n) => `${n}モデル` },
  lenses: {
    title: '分析視点別の的中率',
    note: '視点は各席に回ごとに割り振られる出発点の問いです。同じ回で複数の席が同じ視点になることがあります。',
    withoutLens: (n) => `視点導入前の予測${n}件は除外`,
  },
  extras: {
    pooled: 'エクストラ vs 40 AI（累計）',
    extrasLabel: 'エクストラ',
    ai40Label: '40 AI',
    pooledNote: 'エクストラが答えた回のみ比較します。',
    h2h: 'エクストラ vs AI総合',
    together: (n) => `一緒に答えた${n}回`,
    crowLine: (c, r) => `多数派と逆に出た${c}回のうち${r}回的中`,
    crowAnswered: (n) => `採点済みの回答${n}件`,
    replay: '復習の学習曲線（月別）',
    replayEmpty: 'まだ採点された復習の回答がありません。',
  },
  fame: {
    current: '現在の連続的中',
    longest: '歴代最長の連続的中',
    streak: (n) => `${n}連続`,
    loneWolf: '一匹狼',
    loneWolfNote: (max) => `自分の側が${max}席以下の少数派で当てた回数`,
    times: (n) => `${n}回`,
    bluff: 'ほら吹きランキング',
    bluffNote: (min) => `確信度${min}%以上で外した回数`,
    bluffLine: (h, n) => `${h}回外れ · 高確信${n}件`,
    humble: '謙虚ランキング',
    humbleNote: (max) => `確信度${max}%以下で当てた回数`,
    humbleLine: (h, n) => `${h}回的中 · 低確信${n}件`,
    empty: 'まだ記録がありません。',
    insufficientModels: (n) => `サンプル不足 ${n}モデル`,
  },
  categories: { ai_models: 'AIランキング', crypto_perps: '暗号資産先物', bond_rate: '金利・債券', macro_econ: 'マクロ経済', futures_derivatives: '先物・デリバティブ' },
}

const zhTW: LeaderboardBoardCopy = {
  bannerTitle: 'AI 綜合命中率',
  rateRounds: (pct, n) => `${pct}%（${n} 場）`,
  ratePooled: (pct, rounds, calls) => `${pct}%（${rounds} 場 · ${calls} 筆）`,
  insufficient: (n) => `樣本不足（${n}）`,
  noData: '尚無紀錄',
  coinFlip: '擲硬幣 50%',
  expand: '依領域・期間查看',
  collapse: '收合',
  byCategory: '依領域',
  byHorizon: '依預測期間',
  pending: '正在準備第一次統計，評分完成後會顯示在這裡。',
  scopeLine: (n) => `依據已評分 ${n} 場 · 已排除測試與作廢場次`,
  minSampleNote: (min) => `未滿 ${min} 場時，以「樣本不足（n）」取代百分比與排名。`,
  loading: '載入中…',
  filters: {
    door: '類別',
    category: '領域',
    horizon: '預測期間',
    period: '統計期間',
    all: '全部',
    doors: { finance: '金融', world: '議題', all: '全部' },
    periods: { week: '本週', month: '本月', '90d': '最近 90 天', all: '全部' },
  },
  todayTitle: '今日對決',
  highlights: {
    camp: '美國 vs 中國',
    divination: (name) => `${name} vs AI`,
    siblings: (company) => `兄弟對決 · ${company}`,
    method: '自主推理 vs 網路搜尋',
  },
  ai: 'AI 綜合',
  tabs: { battle: '對決', models: '模型排名', fields: '依領域', companies: '公司・兄弟', lenses: '觀點', extras: '額外席', fame: '名人堂' },
  battle: {
    camp: '陣營',
    tier: '級別',
    book: '自主推理 vs 網路搜尋',
    weights: '封閉權重 vs 開放權重',
    tierNote: 'PREMIER、CHALLENGER、WORLD 拿到同一份研究資料包 — 相同輸入，不同判斷。',
    pooledNote: '場 = 已評分場次 · 筆 = 各席預測加總',
    agreementTitle: '依共識程度的 AI 綜合紀錄',
    share: '多數方比例',
    confidence: '加權信心度',
    shareBuckets: { '85+': '85% 以上', '70-84': '70–84%', '<70': '未滿 70%' },
    confidenceBuckets: { '80+': '80 以上', '70-79': '70–79', '60-69': '60–69', '<60': '未滿 60' },
  },
  models: { official: '40 AI 排名（正式＋偵察）', extras: '額外席（另計）' },
  fields: {
    top: '前 5 名',
    bottom: '後 5 名',
    showAll: '查看完整排名',
    hideAll: '收合',
    ranked: (n) => `已排名 ${n} 個模型`,
    noRanked: '目前還沒有評分足夠可排名的模型。',
  },
  companies: { totals: '公司合計', siblings: '兄弟對決', models: (n) => `${n} 個模型` },
  lenses: {
    title: '依分析觀點的命中率',
    note: '觀點是每個席位每場輪替的起始問題，同一場可能有多個席位拿到相同觀點。',
    withoutLens: (n) => `觀點導入前的 ${n} 筆預測不計入`,
  },
  extras: {
    pooled: '額外席 vs 40 AI（累計）',
    extrasLabel: '額外席',
    ai40Label: '40 AI',
    pooledNote: '只比較額外席有作答的場次。',
    h2h: '額外席 vs AI 綜合',
    together: (n) => `共同作答 ${n} 場`,
    crowLine: (c, r) => `與多數唱反調 ${c} 次，其中命中 ${r} 次`,
    crowAnswered: (n) => `已評分 ${n} 筆`,
    replay: '覆盤學習曲線（每月）',
    replayEmpty: '覆盤尚無已評分的回答。',
  },
  fame: {
    current: '目前連續命中',
    longest: '歷來最長連續命中',
    streak: (n) => `連中 ${n}`,
    loneWolf: '孤狼',
    loneWolfNote: (max) => `在己方 ${max} 席以下的少數派時命中的次數`,
    times: (n) => `${n} 次`,
    bluff: '吹牛榜',
    bluffNote: (min) => `信心 ${min}% 以上卻猜錯的次數`,
    bluffLine: (h, n) => `猜錯 ${h} 次 · 高信心 ${n} 筆`,
    humble: '謙虛榜',
    humbleNote: (max) => `信心 ${max}% 以下卻猜中的次數`,
    humbleLine: (h, n) => `猜中 ${h} 次 · 低信心 ${n} 筆`,
    empty: '尚無紀錄。',
    insufficientModels: (n) => `樣本不足 ${n} 個模型`,
  },
  categories: { ai_models: 'AI 排名', crypto_perps: '加密永續合約', bond_rate: '利率・債券', macro_econ: '總體經濟', futures_derivatives: '期貨・衍生品' },
}

const fr: LeaderboardBoardCopy = {
  bannerTitle: 'Taux de réussite du consensus IA',
  rateRounds: (pct, n) => `${pct}% (${n} manches)`,
  ratePooled: (pct, rounds, calls) => `${pct}% (${rounds} manches · ${calls} appels)`,
  insufficient: (n) => `Échantillon insuffisant (${n})`,
  noData: 'Aucun résultat',
  coinFlip: 'Pile ou face 50%',
  expand: 'Par domaine et horizon',
  collapse: 'Masquer',
  byCategory: 'Par domaine',
  byHorizon: 'Par horizon',
  pending: 'Le premier décompte est en préparation. Les tableaux apparaîtront ici après la notation.',
  scopeLine: (n) => `Sur ${n} manches notées · manches de test et annulées exclues`,
  minSampleNote: (min) =>
    `Sous ${min} manches, un chiffre affiche « Échantillon insuffisant (n) » au lieu d’un pourcentage ou d’un rang.`,
  loading: 'Chargement…',
  filters: {
    door: 'Tableau',
    category: 'Domaine',
    horizon: 'Horizon',
    period: 'Période',
    all: 'Tout',
    doors: { finance: 'Finance', world: 'Actualité', all: 'Tout' },
    periods: { week: 'Cette semaine', month: 'Ce mois-ci', '90d': '90 derniers jours', all: 'Depuis le début' },
  },
  todayTitle: 'Duels du jour',
  highlights: {
    camp: 'États-Unis vs Chine',
    divination: (name) => `${name} vs IA`,
    siblings: (company) => `Duel de famille · ${company}`,
    method: 'Raisonnement seul vs recherche web',
  },
  ai: 'Consensus IA',
  tabs: { battle: 'Duels', models: 'Modèles', fields: 'Par domaine', companies: 'Entreprises', lenses: 'Angles', extras: 'Extras', fame: 'Panthéon' },
  battle: {
    camp: 'Camps',
    tier: 'Niveaux',
    book: 'Raisonnement seul vs recherche web',
    weights: 'Poids fermés vs ouverts',
    tierNote: 'PREMIER, CHALLENGER et WORLD reçoivent le même dossier de recherche — mêmes données, jugements différents.',
    pooledNote: 'manches = manches notées · appels = prédictions de tous les sièges cumulées',
    agreementTitle: 'Consensus IA selon le niveau d’accord',
    share: 'Part de la majorité',
    confidence: 'Confiance pondérée',
    shareBuckets: { '85+': '85% ou plus', '70-84': '70–84%', '<70': 'Moins de 70%' },
    confidenceBuckets: { '80+': '80 et plus', '70-79': '70–79', '60-69': '60–69', '<60': 'Moins de 60' },
  },
  models: { official: 'Les 40 IA (officiel + éclaireurs)', extras: 'Extras (comptés à part)' },
  fields: {
    top: 'Top 5',
    bottom: 'Derniers 5',
    showAll: 'Classement complet',
    hideAll: 'Masquer',
    ranked: (n) => `${n} modèles classés`,
    noRanked: 'Aucun modèle n’a encore assez de manches notées pour être classé.',
  },
  companies: { totals: 'Totaux par entreprise', siblings: 'Duels de famille', models: (n) => `${n} modèles` },
  lenses: {
    title: 'Réussite par angle d’analyse',
    note: 'Un angle est la question de départ attribuée à chaque siège, renouvelée à chaque manche. Plusieurs sièges peuvent partager un angle.',
    withoutLens: (n) => `${n} appels antérieurs aux angles sont exclus`,
  },
  extras: {
    pooled: 'Extras vs 40 IA (cumul)',
    extrasLabel: 'Extras',
    ai40Label: '40 IA',
    pooledNote: 'Seulement les manches où un extra a répondu.',
    h2h: 'Extras vs consensus IA',
    together: (n) => `${n} manches en commun`,
    crowLine: (c, r) => `Contre la majorité ${c} fois, juste ${r} fois`,
    crowAnswered: (n) => `${n} réponses notées`,
    replay: 'Courbe d’apprentissage de la Revue (par mois)',
    replayEmpty: 'Pas encore de réponse notée pour la Revue.',
  },
  fame: {
    current: 'Séries en cours',
    longest: 'Plus longues séries',
    streak: (n) => `${n} d’affilée`,
    loneWolf: 'Loup solitaire',
    loneWolfNote: (max) => `Juste dans un camp de ${max} sièges ou moins, en minorité`,
    times: (n) => `${n} fois`,
    bluff: 'Classement des fanfarons',
    bluffNote: (min) => `Faux avec ${min}% de confiance ou plus`,
    bluffLine: (h, n) => `${h} erreurs · ${n} appels confiants`,
    humble: 'Classement des modestes',
    humbleNote: (max) => `Juste avec ${max}% de confiance ou moins`,
    humbleLine: (h, n) => `${h} réussites · ${n} appels peu confiants`,
    empty: 'Pas encore de résultat.',
    insufficientModels: (n) => `${n} modèles : échantillon insuffisant`,
  },
  categories: { ai_models: 'Classements IA', crypto_perps: 'Perpétuels crypto', bond_rate: 'Taux et obligations', macro_econ: 'Macroéconomie', futures_derivatives: 'Contrats à terme' },
}

const es: LeaderboardBoardCopy = {
  bannerTitle: 'Acierto del consenso IA',
  rateRounds: (pct, n) => `${pct}% (${n} rondas)`,
  ratePooled: (pct, rounds, calls) => `${pct}% (${rounds} rondas · ${calls} llamadas)`,
  insufficient: (n) => `Muestra insuficiente (${n})`,
  noData: 'Sin registro',
  coinFlip: 'Moneda al aire 50%',
  expand: 'Por área y horizonte',
  collapse: 'Ocultar',
  byCategory: 'Por área',
  byHorizon: 'Por horizonte',
  pending: 'Se está preparando el primer recuento. Los tableros aparecerán aquí cuando se califique.',
  scopeLine: (n) => `Con ${n} rondas calificadas · sin rondas de prueba ni anuladas`,
  minSampleNote: (min) => `Con menos de ${min} rondas se muestra «Muestra insuficiente (n)» en lugar de un porcentaje o un puesto.`,
  loading: 'Cargando…',
  filters: {
    door: 'Tablero',
    category: 'Área',
    horizon: 'Horizonte',
    period: 'Periodo',
    all: 'Todo',
    doors: { finance: 'Finanzas', world: 'Actualidad', all: 'Todo' },
    periods: { week: 'Esta semana', month: 'Este mes', '90d': 'Últimos 90 días', all: 'Todo' },
  },
  todayTitle: 'Duelos de hoy',
  highlights: {
    camp: 'EE. UU. vs China',
    divination: (name) => `${name} vs IA`,
    siblings: (company) => `Duelo de hermanos · ${company}`,
    method: 'Razonamiento propio vs búsqueda web',
  },
  ai: 'Consenso IA',
  tabs: { battle: 'Duelos', models: 'Modelos', fields: 'Por área', companies: 'Empresas', lenses: 'Enfoques', extras: 'Extras', fame: 'Salón de la fama' },
  battle: {
    camp: 'Bandos',
    tier: 'Niveles',
    book: 'Razonamiento propio vs búsqueda web',
    weights: 'Pesos cerrados vs abiertos',
    tierNote: 'PREMIER, CHALLENGER y WORLD reciben el mismo paquete de investigación: mismos datos, distinto juicio.',
    pooledNote: 'rondas = rondas calificadas · llamadas = predicciones de todos los asientos sumadas',
    agreementTitle: 'Consenso IA según el nivel de acuerdo',
    share: 'Cuota de la mayoría',
    confidence: 'Confianza ponderada',
    shareBuckets: { '85+': '85% o más', '70-84': '70–84%', '<70': 'Menos de 70%' },
    confidenceBuckets: { '80+': '80 o más', '70-79': '70–79', '60-69': '60–69', '<60': 'Menos de 60' },
  },
  models: { official: 'Las 40 IA (oficial + exploradores)', extras: 'Extras (aparte)' },
  fields: {
    top: 'Top 5',
    bottom: 'Últimos 5',
    showAll: 'Ver clasificación completa',
    hideAll: 'Ocultar',
    ranked: (n) => `${n} modelos clasificados`,
    noRanked: 'Aún ningún modelo tiene suficientes rondas calificadas para clasificarse.',
  },
  companies: { totals: 'Totales por empresa', siblings: 'Duelos de hermanos', models: (n) => `${n} modelos` },
  lenses: {
    title: 'Acierto por enfoque de análisis',
    note: 'Un enfoque es la pregunta inicial que recibe cada asiento, rotada en cada ronda. Varios asientos pueden compartir enfoque.',
    withoutLens: (n) => `Se excluyen ${n} llamadas anteriores a los enfoques`,
  },
  extras: {
    pooled: 'Extras vs 40 IA (acumulado)',
    extrasLabel: 'Extras',
    ai40Label: '40 IA',
    pooledNote: 'Solo rondas en las que respondió un extra.',
    h2h: 'Extras vs consenso IA',
    together: (n) => `${n} rondas respondidas juntos`,
    crowLine: (c, r) => `Fue contra la mayoría ${c} veces y acertó ${r}`,
    crowAnswered: (n) => `${n} respuestas calificadas`,
    replay: 'Curva de aprendizaje del Repaso (mensual)',
    replayEmpty: 'Aún no hay respuestas calificadas del Repaso.',
  },
  fame: {
    current: 'Rachas actuales',
    longest: 'Rachas más largas',
    streak: (n) => `${n} seguidas`,
    loneWolf: 'Lobo solitario',
    loneWolfNote: (max) => `Aciertos en un bando de ${max} asientos o menos, en minoría`,
    times: (n) => `${n} veces`,
    bluff: 'Ranking de fanfarrones',
    bluffNote: (min) => `Fallos con ${min}% de confianza o más`,
    bluffLine: (h, n) => `${h} fallos · ${n} llamadas confiadas`,
    humble: 'Ranking de humildes',
    humbleNote: (max) => `Aciertos con ${max}% de confianza o menos`,
    humbleLine: (h, n) => `${h} aciertos · ${n} llamadas de baja confianza`,
    empty: 'Aún no hay registro.',
    insufficientModels: (n) => `${n} modelos: muestra insuficiente`,
  },
  categories: { ai_models: 'Rankings de IA', crypto_perps: 'Perpetuos cripto', bond_rate: 'Tipos y bonos', macro_econ: 'Macroeconomía', futures_derivatives: 'Futuros' },
}

const ar: LeaderboardBoardCopy = {
  bannerTitle: 'نسبة إصابة إجماع الذكاء الاصطناعي',
  rateRounds: (pct, n) => `${pct}% (${n} جولة)`,
  ratePooled: (pct, rounds, calls) => `${pct}% (${rounds} جولة · ${calls} توقعًا)`,
  insufficient: (n) => `العينة غير كافية (${n})`,
  noData: 'لا سجل',
  coinFlip: 'رمي العملة 50%',
  expand: 'حسب المجال والأفق',
  collapse: 'إخفاء',
  byCategory: 'حسب المجال',
  byHorizon: 'حسب أفق التوقع',
  pending: 'يجري إعداد أول إحصاء. ستظهر اللوحات هنا بعد التقييم.',
  scopeLine: (n) => `استنادًا إلى ${n} جولة مُقيّمة · باستثناء جولات الاختبار والملغاة`,
  minSampleNote: (min) => `أقل من ${min} جولات: يظهر «العينة غير كافية (n)» بدل النسبة أو الترتيب.`,
  loading: 'جارٍ التحميل…',
  filters: {
    door: 'اللوحة',
    category: 'المجال',
    horizon: 'أفق التوقع',
    period: 'الفترة',
    all: 'الكل',
    doors: { finance: 'المال', world: 'القضايا', all: 'الكل' },
    periods: { week: 'هذا الأسبوع', month: 'هذا الشهر', '90d': 'آخر 90 يومًا', all: 'كل الفترات' },
  },
  todayTitle: 'مواجهات اليوم',
  highlights: {
    camp: 'الولايات المتحدة ضد الصين',
    divination: (name) => `${name} ضد الذكاء الاصطناعي`,
    siblings: (company) => `مواجهة الأشقاء · ${company}`,
    method: 'الاستدلال الذاتي ضد البحث على الويب',
  },
  ai: 'إجماع الذكاء الاصطناعي',
  tabs: {
    battle: 'المواجهات',
    models: 'ترتيب النماذج',
    fields: 'حسب المجال',
    companies: 'الشركات',
    lenses: 'زوايا التحليل',
    extras: 'الإضافيون',
    fame: 'قاعة المشاهير',
  },
  battle: {
    camp: 'المعسكرات',
    tier: 'المستويات',
    book: 'الاستدلال الذاتي ضد البحث على الويب',
    weights: 'أوزان مغلقة ضد مفتوحة',
    tierNote: 'تتلقى PREMIER وCHALLENGER وWORLD حزمة البحث نفسها — مدخلات واحدة، وأحكام مختلفة.',
    pooledNote: 'الجولات = الجولات المُقيّمة · التوقعات = مجموع توقعات كل المقاعد',
    agreementTitle: 'سجل الإجماع حسب درجة الاتفاق',
    share: 'حصة الأغلبية',
    confidence: 'الثقة المرجّحة',
    shareBuckets: { '85+': '85% فأكثر', '70-84': '70–84%', '<70': 'أقل من 70%' },
    confidenceBuckets: { '80+': '80 فأكثر', '70-79': '70–79', '60-69': '60–69', '<60': 'أقل من 60' },
  },
  models: { official: 'ترتيب الـ40 (الرسمي + الكشافة)', extras: 'الإضافيون (منفصلون)' },
  fields: {
    top: 'أفضل 5',
    bottom: 'أدنى 5',
    showAll: 'عرض الترتيب الكامل',
    hideAll: 'إخفاء',
    ranked: (n) => `${n} نموذجًا مرتّبًا`,
    noRanked: 'لا يوجد نموذج لديه جولات مُقيّمة كافية للترتيب بعد.',
  },
  companies: { totals: 'إجمالي الشركات', siblings: 'مواجهات الأشقاء', models: (n) => `${n} نماذج` },
  lenses: {
    title: 'نسبة الإصابة حسب زاوية التحليل',
    note: 'الزاوية هي سؤال البداية الذي يُسند لكل مقعد ويتغير كل جولة. قد يشترك عدة مقاعد في زاوية واحدة.',
    withoutLens: (n) => `استُبعد ${n} توقعًا سابقًا لاعتماد الزوايا`,
  },
  extras: {
    pooled: 'الإضافيون ضد الـ40 (تراكمي)',
    extrasLabel: 'الإضافيون',
    ai40Label: 'الـ40',
    pooledNote: 'الجولات التي أجاب فيها إضافي فقط.',
    h2h: 'الإضافيون ضد الإجماع',
    together: (n) => `${n} جولة أجابا فيها معًا`,
    crowLine: (c, r) => `خالف الأغلبية ${c} مرة وأصاب ${r}`,
    crowAnswered: (n) => `${n} إجابة مُقيّمة`,
    replay: 'منحنى تعلّم المراجعة (شهريًا)',
    replayEmpty: 'لا توجد إجابات مُقيّمة للمراجعة بعد.',
  },
  fame: {
    current: 'سلاسل الإصابة الحالية',
    longest: 'أطول سلاسل الإصابة',
    streak: (n) => `${n} متتالية`,
    loneWolf: 'الذئب المنفرد',
    loneWolfNote: (max) => `إصابات في جانب من ${max} مقاعد أو أقل، ضمن الأقلية`,
    times: (n) => `${n} مرات`,
    bluff: 'ترتيب المتبجحين',
    bluffNote: (min) => `أخطاء بثقة ${min}% أو أكثر`,
    bluffLine: (h, n) => `${h} أخطاء · ${n} توقعات واثقة`,
    humble: 'ترتيب المتواضعين',
    humbleNote: (max) => `إصابات بثقة ${max}% أو أقل`,
    humbleLine: (h, n) => `${h} إصابات · ${n} توقعات قليلة الثقة`,
    empty: 'لا سجل بعد.',
    insufficientModels: (n) => `${n} نماذج: العينة غير كافية`,
  },
  categories: {
    ai_models: 'تصنيفات الذكاء الاصطناعي',
    crypto_perps: 'العقود الدائمة للعملات المشفرة',
    bond_rate: 'الفائدة والسندات',
    macro_econ: 'الاقتصاد الكلي',
    futures_derivatives: 'العقود الآجلة',
  },
}

const pt: LeaderboardBoardCopy = {
  bannerTitle: 'Acerto do consenso de IA',
  rateRounds: (pct, n) => `${pct}% (${n} rodadas)`,
  ratePooled: (pct, rounds, calls) => `${pct}% (${rounds} rodadas · ${calls} palpites)`,
  insufficient: (n) => `Amostra insuficiente (${n})`,
  noData: 'Sem registro',
  coinFlip: 'Cara ou coroa 50%',
  expand: 'Por área e horizonte',
  collapse: 'Ocultar',
  byCategory: 'Por área',
  byHorizon: 'Por horizonte',
  pending: 'A primeira contagem está sendo preparada. Os quadros aparecem aqui depois da avaliação.',
  scopeLine: (n) => `Com ${n} rodadas avaliadas · rodadas de teste e anuladas excluídas`,
  minSampleNote: (min) => `Abaixo de ${min} rodadas, aparece “Amostra insuficiente (n)” em vez de porcentagem ou posição.`,
  loading: 'Carregando…',
  filters: {
    door: 'Quadro',
    category: 'Área',
    horizon: 'Horizonte',
    period: 'Período',
    all: 'Tudo',
    doors: { finance: 'Finanças', world: 'Atualidades', all: 'Tudo' },
    periods: { week: 'Esta semana', month: 'Este mês', '90d': 'Últimos 90 dias', all: 'Tudo' },
  },
  todayTitle: 'Duelos de hoje',
  highlights: {
    camp: 'EUA vs China',
    divination: (name) => `${name} vs IA`,
    siblings: (company) => `Duelo de irmãos · ${company}`,
    method: 'Raciocínio próprio vs busca na web',
  },
  ai: 'Consenso de IA',
  tabs: { battle: 'Duelos', models: 'Modelos', fields: 'Por área', companies: 'Empresas', lenses: 'Ângulos', extras: 'Extras', fame: 'Hall da fama' },
  battle: {
    camp: 'Blocos',
    tier: 'Níveis',
    book: 'Raciocínio próprio vs busca na web',
    weights: 'Pesos fechados vs abertos',
    tierNote: 'PREMIER, CHALLENGER e WORLD recebem o mesmo pacote de pesquisa — mesmos dados, julgamentos diferentes.',
    pooledNote: 'rodadas = rodadas avaliadas · palpites = previsões de todos os assentos somadas',
    agreementTitle: 'Consenso de IA por nível de concordância',
    share: 'Fatia da maioria',
    confidence: 'Confiança ponderada',
    shareBuckets: { '85+': '85% ou mais', '70-84': '70–84%', '<70': 'Menos de 70%' },
    confidenceBuckets: { '80+': '80 ou mais', '70-79': '70–79', '60-69': '60–69', '<60': 'Menos de 60' },
  },
  models: { official: 'As 40 IAs (oficial + batedores)', extras: 'Extras (à parte)' },
  fields: {
    top: 'Top 5',
    bottom: 'Últimos 5',
    showAll: 'Ver classificação completa',
    hideAll: 'Ocultar',
    ranked: (n) => `${n} modelos classificados`,
    noRanked: 'Nenhum modelo tem rodadas avaliadas suficientes para ser classificado ainda.',
  },
  companies: { totals: 'Totais por empresa', siblings: 'Duelos de irmãos', models: (n) => `${n} modelos` },
  lenses: {
    title: 'Acerto por ângulo de análise',
    note: 'Um ângulo é a pergunta inicial que cada assento recebe, trocada a cada rodada. Vários assentos podem dividir um ângulo.',
    withoutLens: (n) => `${n} palpites anteriores aos ângulos ficam de fora`,
  },
  extras: {
    pooled: 'Extras vs 40 IAs (acumulado)',
    extrasLabel: 'Extras',
    ai40Label: '40 IAs',
    pooledNote: 'Só rodadas em que um extra respondeu.',
    h2h: 'Extras vs consenso de IA',
    together: (n) => `${n} rodadas respondidas juntos`,
    crowLine: (c, r) => `Foi contra a maioria ${c} vezes e acertou ${r}`,
    crowAnswered: (n) => `${n} respostas avaliadas`,
    replay: 'Curva de aprendizado da Revisão (mensal)',
    replayEmpty: 'Ainda não há respostas avaliadas da Revisão.',
  },
  fame: {
    current: 'Sequências atuais',
    longest: 'Maiores sequências',
    streak: (n) => `${n} seguidas`,
    loneWolf: 'Lobo solitário',
    loneWolfNote: (max) => `Acertos num lado de ${max} assentos ou menos, em minoria`,
    times: (n) => `${n} vezes`,
    bluff: 'Ranking dos fanfarrões',
    bluffNote: (min) => `Erros com ${min}% de confiança ou mais`,
    bluffLine: (h, n) => `${h} erros · ${n} palpites confiantes`,
    humble: 'Ranking dos humildes',
    humbleNote: (max) => `Acertos com ${max}% de confiança ou menos`,
    humbleLine: (h, n) => `${h} acertos · ${n} palpites de baixa confiança`,
    empty: 'Ainda sem registro.',
    insufficientModels: (n) => `${n} modelos: amostra insuficiente`,
  },
  categories: { ai_models: 'Rankings de IA', crypto_perps: 'Perpétuos de cripto', bond_rate: 'Juros e títulos', macro_econ: 'Macroeconomia', futures_derivatives: 'Futuros' },
}

const PACKS: Record<LeagueLocale, LeaderboardBoardCopy> = { en, ko, ja, 'zh-TW': zhTW, fr, es, ar, pt }

export function leaderboardBoardCopy(locale: LeagueLocale): LeaderboardBoardCopy {
  return PACKS[locale] ?? en
}
