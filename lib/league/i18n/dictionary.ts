import type { DirectionTally, LeagueTier } from '../card-types'
import type { LeagueLocale } from './locales'

export type LeagueDirectionWord = 'up' | 'down' | 'flat'

/**
 * AI Prediction League — CHROME dictionary (Layer A).
 *
 * Every user-facing STRING the card renders lives here, per locale. This is
 * the ONLY place a translated sentence gets assembled — `lib/league/compliance.ts`
 * calls into a `LeagueUiPack` rather than hard-coding English, so a locale
 * cannot skip the regulatory phrasing/disclaimer by omission (there is no
 * "default English fallback" for the compliance-critical fields; every real
 * locale below fills them in explicitly).
 *
 * WHAT IS NOT HERE (and never will be, in this pass): `reasoning_snippet`
 * (a model's own free-text output) and any other prediction DATA
 * (direction/probability/model list membership). Those are language-neutral
 * facts, not chrome — see `lib/league/card-aggregate.ts`. Translating model
 * reasoning is a separate, explicitly-deferred feature (would mean
 * machine-translating up to ~20+ snippets per view, per language, per
 * request — a real cost/latency problem, not just an i18n one).
 */
export type LeagueUiPack = {
  direction: {
    /** Short badge word per model row, e.g. "UP". */
    badge: Record<LeagueDirectionWord, string>
    noCallBadge: string
    /** Lowercase word used inside a tally sentence, e.g. "3 up". */
    tally: Record<LeagueDirectionWord, string>
    noCallTally: string
  }
  headline: {
    majority: (majorityCount: number, totalModels: number, direction: LeagueDirectionWord, confidencePct: number | null) => string
    allAbstain: (totalModels: number) => string
    split: (respondedModels: number, totalModels: number) => string
    none: string
  }
  /** e.g. "US: 3 up · 1 down · 1 no call" — `label` (e.g. "US"/"Premier") is passed through untranslated (a proper-noun-ish group name). */
  groupTallyLine: (label: string, tally: DirectionTally) => string
  disclaimer: { short: string; long: string }
  hitRate: { pending: string; pct: (pct: number) => string }
  modelList: {
    title: (count: number) => string
    tierTab: string
    campTab: string
    empty: string
    correct: string
    missed: string
  }
  /**
   * Cards-tab board chrome (division headers + final-verdict label).
   * Directional SENTENCES still come only from `headline` / `compliance.ts`.
   * `compactTally` is a ticker-style count (glyphs + numbers), not advice.
   */
  bracket: {
    finalVerdict: string
    division: Record<LeagueTier, string>
    compactTally: (tally: DirectionTally) => string
    showReasoning: string
    hideReasoning: string
    /** Short label making clear the % is the model's OWN confidence in its call. */
    confidence: string
    /** Legend for the correct/missed markers — only rendered once a round is resolved. */
    resultLegend: string
  }
  gating: {
    /** Shown (localized) when JurisdictionGate hides a category for this user. */
    unavailable: string
    /** ToS-style note: users must use their real jurisdiction. */
    tosNote: string
  }
  languageToggleLabel: string
  /**
   * Leaderboard chrome (read-only rankings aggregated from already-resolved
   * predictions — see `lib/league/leaderboard-aggregate.ts`). No buy/sell
   * framing lives here — this is model PERFORMANCE, not investment advice —
   * but every locale still carries the same disclaimer via `disclaimer`
   * above, rendered through the same `DisclaimerFooter`/`CardCompliance`
   * wrapper as the prediction card.
   */
  leaderboard: {
    title: string
    subtitle: string
    tabs: { model: string; camp: string; tier: string; category: string }
    /** Headline label above the camp view's US vs China comparison — the product's viral hook. */
    campHeadline: string
    columns: { rank: string; name: string; winRate: string; sample: string }
    /** e.g. "12 resolved". Always shown alongside a win rate — see `provisionalBadge`. */
    sampleCount: (n: number) => string
    /** Badge text for any row with n below the provisional threshold. */
    provisionalBadge: string
    /** One-line explainer of what "provisional" means, shown once per screen. */
    provisionalNote: string
    /** Shown when a slice (or the whole leaderboard) has zero resolved predictions yet. */
    emptyState: string
    asOf: (date: string) => string
  }
  /** Record room chrome (immutable, timestamped log of resolved rounds — see `lib/league/record-room-aggregate.ts`). */
  recordRoom: {
    title: string
    subtitle: string
    outcomeLabel: string
    resolvedAtLabel: string
    /** e.g. "6/8 correct". */
    modelsScore: (correct: number, total: number) => string
    correct: string
    incorrect: string
    /** Grade badge for a model whose is_correct is still null even though the round resolved (e.g. scout tier). */
    ungraded: string
    emptyState: string
    pagination: { prev: string; next: string; pageOf: (page: number, totalPages: number) => string }
  }
  /**
   * Public (logged-in, non-admin) league hub chrome — the surface at `/league`.
   *
   * `freeReadNote` and `generateLive` are the money-facing strings and are
   * therefore treated like compliance copy: every real locale states plainly
   * that browsing is free and exactly what a live run costs, so a user is
   * never charged by a button whose price they could not read.
   */
  hub: {
    title: string
    subtitle: string
    tabs: { cards: string; leaderboard: string; recordRoom: string }
    loading: string
    /** Shown when the viewer's jurisdiction allows no league category at all. */
    noInstruments: string
    /** Paid CTA — MUST carry its price. */
    generateLive: (credits: number) => string
    generating: string
    /** States the free-vs-paid split up front. */
    freeReadNote: string
    insufficientCredits: (required: number, balance: number) => string
    rateLimited: string
    genericError: string
    balance: (credits: number) => string
  }
}

/** Ticker-style division tally. Glyphs are language-neutral; locales may override. */
function compactTally(tally: DirectionTally): string {
  const parts = [`${tally.up}▲`, `${tally.down}▼`]
  if (tally.flat) parts.push(`${tally.flat}■`)
  if (tally.abstain) parts.push(`${tally.abstain}–`)
  return parts.join(' / ')
}

const en: LeagueUiPack = {
  direction: {
    badge: { up: 'UP', down: 'DOWN', flat: 'FLAT' },
    noCallBadge: 'NO CALL',
    tally: { up: 'up', down: 'down', flat: 'flat' },
    noCallTally: 'no call',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: 'lean UP', down: 'lean DOWN', flat: 'lean FLAT' }[dir]
      const suffix = conf !== null ? ` · ${Math.round(conf)}% avg confidence` : ''
      return `${count} of ${total} AI models ${word}${suffix}`
    },
    allAbstain: (total) => `All ${total} AI models abstained on this round`,
    split: (responded, total) => `${responded} of ${total} AI models are split — no clear lean`,
    none: 'No AI models have reported for this round yet',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`${tally.up} up`)
    if (tally.down) parts.push(`${tally.down} down`)
    if (tally.flat) parts.push(`${tally.flat} flat`)
    if (tally.abstain) parts.push(`${tally.abstain} no call`)
    return `${label}: ${parts.length ? parts.join(' · ') : 'no responses yet'}`
  },
  disclaimer: {
    short: 'Info only — not investment advice. You are responsible for your own decisions.',
    long: 'These are AI model opinions shown for information and entertainment purposes only. They are not investment, financial, legal, or professional advice, and no model here is a licensed advisor. Markets are unpredictable and AI models can be — and often are — wrong. You are solely responsible for any decision you make.',
  },
  hitRate: { pending: 'Hit rate: pending', pct: (pct) => `${pct}% hit rate` },
  modelList: {
    title: (n) => `Models (${n})`,
    tierTab: 'Tier',
    campTab: 'Camp',
    empty: 'No models have reported yet.',
    correct: 'Correct',
    missed: 'Missed',
  },
  bracket: {
    finalVerdict: 'Final verdict',
    division: {
      premier: '1 · PREMIER',
      challenger: '2 · CHALLENGER',
      world: '3 · WORLD',
      scout: 'SCOUT',
    },
    compactTally,
    showReasoning: 'Show reasoning',
    hideReasoning: 'Hide reasoning',
    confidence: 'confidence',
    resultLegend:
      '✓ correct — the AI\u2019s call matched the actual outcome · ✗ missed — it didn\u2019t. Shown only after the round resolves.',
  },
  gating: {
    unavailable: 'This prediction category isn\u2019t available in your region yet.',
    tosNote: 'Availability is based on your account\u2019s declared country and detected location. You must use your real jurisdiction \u2014 attempting to bypass this (e.g. via VPN) shifts responsibility for any resulting misuse to you.',
  },
  languageToggleLabel: 'Language',
  leaderboard: {
    title: 'Leaderboard',
    subtitle: 'Win rates computed only from resolved predictions — not investment advice.',
    tabs: { model: 'Model', camp: 'Camp', tier: 'Tier', category: 'Category' },
    campHeadline: 'US vs. China',
    columns: { rank: '#', name: 'Name', winRate: 'Win rate', sample: 'Sample' },
    sampleCount: (n) => `${n} resolved`,
    provisionalBadge: 'Provisional',
    provisionalNote: 'Provisional = fewer than 10 resolved predictions. Treat these win rates as early signal, not a settled record.',
    emptyState: 'Not enough resolved predictions yet — check back as more rounds resolve.',
    asOf: (date) => `As of ${date}`,
  },
  recordRoom: {
    title: 'Record room',
    subtitle: 'Every resolved round, with the actual outcome and each model\u2019s call. Read-only, immutable.',
    outcomeLabel: 'Actual outcome',
    resolvedAtLabel: 'Resolved',
    modelsScore: (correct, total) => `${correct}/${total} correct`,
    correct: 'Correct',
    incorrect: 'Incorrect',
    ungraded: 'Ungraded',
    emptyState: 'No rounds have resolved yet.',
    pagination: { prev: 'Previous', next: 'Next', pageOf: (page, totalPages) => `Page ${page} of ${totalPages}` },
  },
  hub: {
    title: 'AI Prediction League',
    subtitle: 'What the world\u2019s AI models predict \u2014 and how often they turned out to be right.',
    tabs: { cards: 'Cards', leaderboard: 'Leaderboard', recordRoom: 'Record room' },
    loading: 'Loading\u2026',
    noInstruments: 'The league isn\u2019t available in your region yet.',
    generateLive: (credits) => `Ask the models now \u00b7 ${credits} credits`,
    generating: 'Asking the models\u2026',
    freeReadNote: 'Browsing cards, the leaderboard and the record room is free. Only a live run spends credits.',
    insufficientCredits: (required, balance) => `A live run needs ${required} credits \u2014 you have ${balance}.`,
    rateLimited: 'Too many requests. Please wait a moment and try again.',
    genericError: 'Something went wrong. Please try again.',
    balance: (credits) => `${credits} credits`,
  },
}

const ko: LeagueUiPack = {
  direction: {
    badge: { up: '상승', down: '하락', flat: '보합' },
    noCallBadge: '의견 없음',
    tally: { up: '상승', down: '하락', flat: '보합' },
    noCallTally: '의견 없음',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: '상승', down: '하락', flat: '보합' }[dir]
      const suffix = conf !== null ? ` · 평균 신뢰도 ${Math.round(conf)}%` : ''
      return `AI 모델 ${total}개 중 ${count}개가 ${word}에 무게를 둠${suffix}`
    },
    allAbstain: (total) => `AI 모델 ${total}개 전원이 이번 라운드 의견을 유보했습니다`,
    split: (responded, total) => `AI 모델 ${total}개 중 ${responded}개가 의견을 냈지만 방향이 갈립니다 — 뚜렷한 우세 없음`,
    none: '아직 이번 라운드에 응답한 AI 모델이 없습니다',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`상승 ${tally.up}`)
    if (tally.down) parts.push(`하락 ${tally.down}`)
    if (tally.flat) parts.push(`보합 ${tally.flat}`)
    if (tally.abstain) parts.push(`의견없음 ${tally.abstain}`)
    return `${label}: ${parts.length ? parts.join(' · ') : '아직 응답 없음'}`
  },
  disclaimer: {
    short: '정보 제공 목적일 뿐 투자 조언이 아닙니다. 모든 결정의 책임은 본인에게 있습니다.',
    long: '본 콘텐츠는 여러 AI 모델의 의견을 정보 및 오락 목적으로 제공하는 것이며, 투자·금융·법률·전문 자문이 아닙니다. 여기 등장하는 어떤 모델도 인가받은 자문가가 아닙니다. 시장은 예측할 수 없으며 AI 모델의 예측은 자주, 그리고 크게 틀릴 수 있습니다. 이를 근거로 내리는 모든 결정의 책임은 전적으로 본인에게 있습니다.',
  },
  hitRate: { pending: '적중률 집계 중', pct: (pct) => `적중률 ${pct}%` },
  modelList: {
    title: (n) => `모델 (${n}개)`,
    tierTab: '티어',
    campTab: '진영',
    empty: '아직 응답한 모델이 없습니다.',
    correct: '적중',
    missed: '실패',
  },
  bracket: {
    finalVerdict: '최종 판정',
    division: {
      premier: '1부 PREMIER',
      challenger: '2부 CHALLENGER',
      world: '3부 WORLD',
      scout: 'SCOUT',
    },
    compactTally,
    showReasoning: '근거 보기',
    hideReasoning: '근거 숨기기',
    confidence: '확신도',
    resultLegend: '✓ 적중 — AI 예측이 실제 결과와 일치 · ✗ 실패 — 불일치. 라운드 확정 후에만 표시됩니다.',
  },
  gating: {
    unavailable: '이 예측 카테고리는 아직 회원님의 지역에서 제공되지 않습니다.',
    tosNote: '노출 여부는 계정에 등록된 국가와 감지된 접속 위치를 기준으로 결정됩니다. 반드시 실제 관할 지역을 사용해야 하며, VPN 등으로 이를 우회하려는 시도로 발생하는 문제의 책임은 이용자 본인에게 있습니다.',
  },
  languageToggleLabel: '언어',
  leaderboard: {
    title: '리더보드',
    subtitle: '이미 결과가 확정된 예측만으로 계산한 적중률입니다 — 투자 조언이 아닙니다.',
    tabs: { model: '모델', camp: '진영', tier: '티어', category: '카테고리' },
    campHeadline: '미국 vs 중국',
    columns: { rank: '순위', name: '이름', winRate: '적중률', sample: '표본' },
    sampleCount: (n) => `${n}건 확정`,
    provisionalBadge: '잠정',
    provisionalNote: '잠정 = 확정된 예측이 10건 미만입니다. 아직 확정된 기록이 아니라 초기 신호로만 참고하세요.',
    emptyState: '아직 결과가 확정된 예측이 충분하지 않습니다 — 라운드가 더 확정되면 다시 확인해 주세요.',
    asOf: (date) => `${date} 기준`,
  },
  recordRoom: {
    title: '기록실',
    subtitle: '결과가 확정된 모든 라운드와 실제 결과, 각 모델의 예측을 보여줍니다. 읽기 전용이며 수정되지 않습니다.',
    outcomeLabel: '실제 결과',
    resolvedAtLabel: '확정 시각',
    modelsScore: (correct, total) => `${total}개 중 ${correct}개 적중`,
    correct: '적중',
    incorrect: '실패',
    ungraded: '채점 없음',
    emptyState: '아직 결과가 확정된 라운드가 없습니다.',
    pagination: { prev: '이전', next: '다음', pageOf: (page, totalPages) => `${totalPages}페이지 중 ${page}페이지` },
  },
  hub: {
    title: 'AI 예측 리그',
    subtitle: '전 세계 AI 모델들이 무엇을 예측했고, 실제로 얼마나 맞혔는지 확인하세요.',
    tabs: { cards: '카드', leaderboard: '리더보드', recordRoom: '기록실' },
    loading: '불러오는 중…',
    noInstruments: '아직 회원님의 지역에서는 리그를 이용할 수 없습니다.',
    generateLive: (credits) => `지금 모델에게 물어보기 · ${credits} 크레딧`,
    generating: '모델에게 묻는 중…',
    freeReadNote: '카드·리더보드·기록실 열람은 무료입니다. 실시간 실행에만 크레딧이 사용됩니다.',
    insufficientCredits: (required, balance) => `실시간 실행에는 ${required} 크레딧이 필요합니다 — 현재 보유 ${balance} 크레딧.`,
    rateLimited: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
    genericError: '문제가 발생했습니다. 다시 시도해 주세요.',
    balance: (credits) => `${credits} 크레딧`,
  },
}

const ja: LeagueUiPack = {
  direction: {
    badge: { up: '上昇', down: '下落', flat: '横ばい' },
    noCallBadge: '判断なし',
    tally: { up: '上昇', down: '下落', flat: '横ばい' },
    noCallTally: '判断なし',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: '上昇', down: '下落', flat: '横ばい' }[dir]
      const suffix = conf !== null ? `・平均確信度${Math.round(conf)}%` : ''
      return `AIモデル${total}体中${count}体が${word}に傾いています${suffix}`
    },
    allAbstain: (total) => `AIモデル${total}体全てが今回の判断を保留しました`,
    split: (responded, total) => `AIモデル${total}体中${responded}体が回答しましたが意見が分かれ、明確な優勢はありません`,
    none: 'このラウンドにはまだ回答したAIモデルがありません',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`上昇${tally.up}`)
    if (tally.down) parts.push(`下落${tally.down}`)
    if (tally.flat) parts.push(`横ばい${tally.flat}`)
    if (tally.abstain) parts.push(`判断なし${tally.abstain}`)
    return `${label}：${parts.length ? parts.join('・') : 'まだ回答なし'}`
  },
  disclaimer: {
    short: '情報提供のみを目的としており、投資助言ではありません。ご自身の判断と責任でご利用ください。',
    long: 'この内容は複数のAIモデルの見解を情報提供・娯楽目的で示したものであり、投資・金融・法律・専門的な助言ではありません。ここに登場するモデルはいずれも認可を受けたアドバイザーではありません。市場は予測不可能であり、AIモデルの予測は誤ることが多々あります。これに基づく判断の責任はすべてご自身が負うものとします。',
  },
  hitRate: { pending: '的中率：集計待ち', pct: (pct) => `的中率${pct}%` },
  modelList: {
    title: (n) => `モデル（${n}）`,
    tierTab: 'ティア',
    campTab: '陣営',
    empty: 'まだ回答したモデルがありません。',
    correct: '的中',
    missed: '外れ',
  },
  bracket: {
    finalVerdict: '最終判定',
    division: {
      premier: '1部 PREMIER',
      challenger: '2部 CHALLENGER',
      world: '3部 WORLD',
      scout: 'SCOUT',
    },
    compactTally,
    showReasoning: '根拠を表示',
    hideReasoning: '根拠を隠す',
    confidence: '確信度',
    resultLegend: '✓ 的中 — AIの予測が実際の結果と一致 · ✗ 不的中 — 不一致。ラウンド確定後のみ表示されます。',
  },
  gating: {
    unavailable: 'この予測カテゴリーは、お住まいの地域ではまだご利用いただけません。',
    tosNote: '表示可否はアカウントに登録された国と検出された接続地域に基づいて判定されます。実際の管轄地域を使用してください。VPN等でこれを回避しようとした場合に生じる問題の責任はご自身が負うものとします。',
  },
  languageToggleLabel: '言語',
  leaderboard: {
    title: 'リーダーボード',
    subtitle: '確定済みの予測のみから算出した的中率です — 投資助言ではありません。',
    tabs: { model: 'モデル', camp: '陣営', tier: 'ティア', category: 'カテゴリー' },
    campHeadline: '米国 vs 中国',
    columns: { rank: '順位', name: '名前', winRate: '的中率', sample: 'サンプル数' },
    sampleCount: (n) => `確定${n}件`,
    provisionalBadge: '暫定',
    provisionalNote: '暫定 = 確定した予測が10件未満です。確定した実績ではなく、初期的な傾向としてご覧ください。',
    emptyState: 'まだ確定した予測が十分にありません — ラウンドが確定するたびに更新されます。',
    asOf: (date) => `${date}時点`,
  },
  recordRoom: {
    title: '記録室',
    subtitle: '確定した全ラウンドの実際の結果と各モデルの判断を掲載しています。閲覧専用で改変されません。',
    outcomeLabel: '実際の結果',
    resolvedAtLabel: '確定日時',
    modelsScore: (correct, total) => `${total}体中${correct}体的中`,
    correct: '的中',
    incorrect: '外れ',
    ungraded: '未採点',
    emptyState: 'まだ確定したラウンドがありません。',
    pagination: { prev: '前へ', next: '次へ', pageOf: (page, totalPages) => `${totalPages}ページ中${page}ページ目` },
  },
  hub: {
    title: 'AI予測リーグ',
    subtitle: '世界のAIモデルが何を予測し、実際にどれだけ的中したかを見られます。',
    tabs: { cards: 'カード', leaderboard: 'リーダーボード', recordRoom: '記録室' },
    loading: '読み込み中…',
    noInstruments: 'お住まいの地域では、リーグはまだご利用いただけません。',
    generateLive: (credits) => `今すぐモデルに聞く・${credits}クレジット`,
    generating: 'モデルに問い合わせ中…',
    freeReadNote: 'カード・リーダーボード・記録室の閲覧は無料です。クレジットを消費するのはライブ実行のみです。',
    insufficientCredits: (required, balance) => `ライブ実行には${required}クレジットが必要です — 現在の残高は${balance}クレジットです。`,
    rateLimited: 'リクエストが多すぎます。少し時間をおいて再度お試しください。',
    genericError: 'エラーが発生しました。もう一度お試しください。',
    balance: (credits) => `${credits}クレジット`,
  },
}

const zhTW: LeagueUiPack = {
  direction: {
    badge: { up: '看漲', down: '看跌', flat: '持平' },
    noCallBadge: '未表態',
    tally: { up: '看漲', down: '看跌', flat: '持平' },
    noCallTally: '未表態',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: '看漲', down: '看跌', flat: '持平' }[dir]
      const suffix = conf !== null ? `・平均信心指數 ${Math.round(conf)}%` : ''
      return `${total} 個 AI 模型中有 ${count} 個傾向${word}${suffix}`
    },
    allAbstain: (total) => `全部 ${total} 個 AI 模型本輪均未表態`,
    split: (responded, total) => `${total} 個 AI 模型中有 ${responded} 個給出意見，但看法分歧，沒有明顯多數`,
    none: '本輪目前尚無 AI 模型回應',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`看漲 ${tally.up}`)
    if (tally.down) parts.push(`看跌 ${tally.down}`)
    if (tally.flat) parts.push(`持平 ${tally.flat}`)
    if (tally.abstain) parts.push(`未表態 ${tally.abstain}`)
    return `${label}：${parts.length ? parts.join('・') : '尚無回應'}`
  },
  disclaimer: {
    short: '僅供參考，非投資建議。所有決定的責任由您自行承擔。',
    long: '本內容為多個 AI 模型的意見，僅供資訊與娛樂用途，並非投資、財務、法律或專業建議；此處任何模型皆非持牌顧問。市場無法預測，AI 模型的判斷經常出錯。您必須自行承擔依此做出之任何決定的全部責任。',
  },
  hitRate: { pending: '命中率：統計中', pct: (pct) => `命中率 ${pct}%` },
  modelList: {
    title: (n) => `模型（${n}）`,
    tierTab: '級別',
    campTab: '陣營',
    empty: '目前尚無模型回應。',
    correct: '命中',
    missed: '未命中',
  },
  bracket: {
    finalVerdict: '最終判定',
    division: {
      premier: '1級 PREMIER',
      challenger: '2級 CHALLENGER',
      world: '3級 WORLD',
      scout: 'SCOUT',
    },
    compactTally,
    showReasoning: '顯示理由',
    hideReasoning: '隱藏理由',
    confidence: '信心度',
    resultLegend: '✓ 命中 — AI 預測與實際結果一致 · ✗ 未中 — 不一致。僅在回合結算後顯示。',
  },
  gating: {
    unavailable: '此預測類別在您所在地區尚未開放。',
    tosNote: '是否顯示取決於您帳號登記的國家與偵測到的所在位置。您必須使用真實所在地區；若透過 VPN 等方式規避此限制，由此產生的任何後果由您自行承擔。',
  },
  languageToggleLabel: '語言',
  leaderboard: {
    title: '排行榜',
    subtitle: '命中率僅根據已結算的預測計算 — 並非投資建議。',
    tabs: { model: '模型', camp: '陣營', tier: '級別', category: '類別' },
    campHeadline: '美國 vs 中國',
    columns: { rank: '排名', name: '名稱', winRate: '命中率', sample: '樣本數' },
    sampleCount: (n) => `已結算 ${n} 筆`,
    provisionalBadge: '暫定',
    provisionalNote: '暫定＝已結算的預測少於 10 筆。請將此視為初步訊號，而非穩定紀錄。',
    emptyState: '目前已結算的預測還不夠多 — 之後會有更多輪次結算，請稍後再查看。',
    asOf: (date) => `更新於 ${date}`,
  },
  recordRoom: {
    title: '紀錄室',
    subtitle: '列出所有已結算的輪次，包含實際結果與每個模型的判斷。僅供查閱，內容不可更改。',
    outcomeLabel: '實際結果',
    resolvedAtLabel: '結算時間',
    modelsScore: (correct, total) => `${total} 個中命中 ${correct} 個`,
    correct: '命中',
    incorrect: '未命中',
    ungraded: '未評分',
    emptyState: '目前尚無已結算的輪次。',
    pagination: { prev: '上一頁', next: '下一頁', pageOf: (page, totalPages) => `第 ${page} 頁，共 ${totalPages} 頁` },
  },
  hub: {
    title: 'AI 預測聯賽',
    subtitle: '看看全球 AI 模型預測了什麼，以及它們實際命中的紀錄。',
    tabs: { cards: '卡片', leaderboard: '排行榜', recordRoom: '紀錄室' },
    loading: '載入中…',
    noInstruments: '您所在的地區尚未開放本聯賽。',
    generateLive: (credits) => `立即詢問模型・${credits} 點數`,
    generating: '正在詢問模型…',
    freeReadNote: '瀏覽卡片、排行榜與紀錄室皆為免費，只有即時執行才會消耗點數。',
    insufficientCredits: (required, balance) => `即時執行需要 ${required} 點數 — 您目前有 ${balance} 點。`,
    rateLimited: '請求過於頻繁，請稍候再試。',
    genericError: '發生錯誤，請再試一次。',
    balance: (credits) => `${credits} 點數`,
  },
}

const fr: LeagueUiPack = {
  direction: {
    badge: { up: 'HAUSSE', down: 'BAISSE', flat: 'STABLE' },
    noCallBadge: 'SANS AVIS',
    tally: { up: 'hausse', down: 'baisse', flat: 'stable' },
    noCallTally: 'sans avis',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: 'à la hausse', down: 'à la baisse', flat: 'stables' }[dir]
      const suffix = conf !== null ? ` · confiance moyenne de ${Math.round(conf)}%` : ''
      return `${count} modèles IA sur ${total} penchent ${word}${suffix}`
    },
    allAbstain: (total) => `Les ${total} modèles IA se sont tous abstenus pour ce tour`,
    split: (responded, total) => `${responded} modèles IA sur ${total} ont répondu, mais les avis sont partagés — aucune tendance claire`,
    none: 'Aucun modèle IA n\u2019a encore répondu pour ce tour',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`${tally.up} hausse`)
    if (tally.down) parts.push(`${tally.down} baisse`)
    if (tally.flat) parts.push(`${tally.flat} stable`)
    if (tally.abstain) parts.push(`${tally.abstain} sans avis`)
    return `${label} : ${parts.length ? parts.join(' · ') : 'aucune réponse pour le moment'}`
  },
  disclaimer: {
    short: 'Information uniquement, ceci n\u2019est pas un conseil en investissement. Vous êtes seul responsable de vos décisions.',
    long: 'Ce contenu présente les avis de plusieurs modèles d\u2019IA à titre purement informatif et de divertissement. Il ne s\u2019agit pas d\u2019un conseil en investissement, financier, juridique ou professionnel, et aucun modèle ici n\u2019est un conseiller agréé. Les marchés sont imprévisibles et les modèles d\u2019IA peuvent se tromper, et se trompent souvent. Vous assumez l\u2019entière responsabilité de toute décision prise sur cette base.',
  },
  hitRate: { pending: 'Taux de réussite : en attente', pct: (pct) => `${pct}% de réussite` },
  modelList: {
    title: (n) => `Modèles (${n})`,
    tierTab: 'Niveau',
    campTab: 'Camp',
    empty: 'Aucun modèle n\u2019a encore répondu.',
    correct: 'Correct',
    missed: 'Manqué',
  },
  bracket: {
    finalVerdict: 'Verdict final',
    division: {
      premier: '1re · PREMIER',
      challenger: '2e · CHALLENGER',
      world: '3e · WORLD',
      scout: 'SCOUT',
    },
    compactTally,
    showReasoning: 'Voir le raisonnement',
    hideReasoning: 'Masquer le raisonnement',
    confidence: 'confiance',
    resultLegend:
      '✓ correct — la prédiction de l\u2019IA correspond au résultat réel · ✗ manqué — sinon. Affiché uniquement après la résolution.',
  },
  gating: {
    unavailable: 'Cette catégorie de prédiction n\u2019est pas encore disponible dans votre région.',
    tosNote: 'La disponibilité dépend du pays déclaré sur votre compte et de votre localisation détectée. Vous devez utiliser votre véritable juridiction \u2014 toute tentative de contournement (par VPN, par exemple) vous rend responsable des conséquences.',
  },
  languageToggleLabel: 'Langue',
  leaderboard: {
    title: 'Classement',
    subtitle: 'Taux de réussite calculés uniquement sur les prédictions résolues — ceci n\u2019est pas un conseil en investissement.',
    tabs: { model: 'Modèle', camp: 'Camp', tier: 'Niveau', category: 'Catégorie' },
    campHeadline: '\u00c9tats-Unis vs Chine',
    columns: { rank: '#', name: 'Nom', winRate: 'Taux de réussite', sample: 'Échantillon' },
    sampleCount: (n) => `${n} résolues`,
    provisionalBadge: 'Provisoire',
    provisionalNote: 'Provisoire = moins de 10 prédictions résolues. À considérer comme un signal précoce, pas comme un résultat établi.',
    emptyState: 'Pas encore assez de prédictions résolues — revenez plus tard, au fil des résolutions.',
    asOf: (date) => `Au ${date}`,
  },
  recordRoom: {
    title: 'Salle des archives',
    subtitle: 'Chaque tour résolu, avec le résultat réel et la réponse de chaque modèle. Lecture seule, immuable.',
    outcomeLabel: 'Résultat réel',
    resolvedAtLabel: 'Résolu le',
    modelsScore: (correct, total) => `${correct}/${total} correct(s)`,
    correct: 'Correct',
    incorrect: 'Incorrect',
    ungraded: 'Non noté',
    emptyState: 'Aucun tour n\u2019a encore été résolu.',
    pagination: { prev: 'Précédent', next: 'Suivant', pageOf: (page, totalPages) => `Page ${page} sur ${totalPages}` },
  },
  hub: {
    title: 'Ligue de prédiction IA',
    subtitle: 'Ce que prédisent les modèles d\u2019IA du monde entier \u2014 et à quelle fréquence ils ont eu raison.',
    tabs: { cards: 'Cartes', leaderboard: 'Classement', recordRoom: 'Archives' },
    loading: 'Chargement\u2026',
    noInstruments: 'La ligue n\u2019est pas encore disponible dans votre région.',
    generateLive: (credits) => `Interroger les modèles maintenant \u00b7 ${credits} crédits`,
    generating: 'Interrogation des modèles\u2026',
    freeReadNote: 'Consulter les cartes, le classement et les archives est gratuit. Seule une exécution en direct consomme des crédits.',
    insufficientCredits: (required, balance) => `Une exécution en direct coûte ${required} crédits \u2014 vous en avez ${balance}.`,
    rateLimited: 'Trop de requêtes. Patientez un instant avant de réessayer.',
    genericError: 'Une erreur est survenue. Veuillez réessayer.',
    balance: (credits) => `${credits} crédits`,
  },
}

const es: LeagueUiPack = {
  direction: {
    badge: { up: 'SUBE', down: 'BAJA', flat: 'ESTABLE' },
    noCallBadge: 'SIN OPINIÓN',
    tally: { up: 'sube', down: 'baja', flat: 'estable' },
    noCallTally: 'sin opinión',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: 'a la suba', down: 'a la baja', flat: 'estable' }[dir]
      const suffix = conf !== null ? ` · confianza media del ${Math.round(conf)}%` : ''
      return `${count} de ${total} modelos de IA se inclinan ${word}${suffix}`
    },
    allAbstain: (total) => `Los ${total} modelos de IA se abstuvieron en esta ronda`,
    split: (responded, total) => `${responded} de ${total} modelos de IA respondieron, pero están divididos — sin tendencia clara`,
    none: 'Todavía ningún modelo de IA respondió en esta ronda',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`${tally.up} sube`)
    if (tally.down) parts.push(`${tally.down} baja`)
    if (tally.flat) parts.push(`${tally.flat} estable`)
    if (tally.abstain) parts.push(`${tally.abstain} sin opinión`)
    return `${label}: ${parts.length ? parts.join(' · ') : 'sin respuestas todavía'}`
  },
  disclaimer: {
    short: 'Solo información, no es asesoramiento de inversión. Usted es responsable de sus propias decisiones.',
    long: 'Este contenido muestra opiniones de varios modelos de IA con fines informativos y de entretenimiento únicamente. No constituye asesoramiento de inversión, financiero, legal ni profesional, y ninguno de estos modelos es un asesor autorizado. Los mercados son impredecibles y los modelos de IA pueden equivocarse, y a menudo lo hacen. Usted es el único responsable de cualquier decisión que tome con base en esta información.',
  },
  hitRate: { pending: 'Tasa de acierto: pendiente', pct: (pct) => `${pct}% de acierto` },
  modelList: {
    title: (n) => `Modelos (${n})`,
    tierTab: 'Nivel',
    campTab: 'Bloque',
    empty: 'Todavía ningún modelo ha respondido.',
    correct: 'Acertó',
    missed: 'Falló',
  },
  bracket: {
    finalVerdict: 'Veredicto final',
    division: {
      premier: '1.ª · PREMIER',
      challenger: '2.ª · CHALLENGER',
      world: '3.ª · WORLD',
      scout: 'SCOUT',
    },
    compactTally,
    showReasoning: 'Ver el razonamiento',
    hideReasoning: 'Ocultar el razonamiento',
    confidence: 'confianza',
    resultLegend:
      '✓ acierto — la predicción de la IA coincide con el resultado real · ✗ fallo — no coincide. Solo se muestra tras la resolución.',
  },
  gating: {
    unavailable: 'Esta categoría de predicción todavía no está disponible en tu región.',
    tosNote: 'La disponibilidad depende del país declarado en tu cuenta y de tu ubicación detectada. Debes usar tu jurisdicción real: si intentas evadir esto (por ejemplo, con una VPN), asumes la responsabilidad de las consecuencias.',
  },
  languageToggleLabel: 'Idioma',
  leaderboard: {
    title: 'Tabla de posiciones',
    subtitle: 'Tasas de acierto calculadas solo con predicciones ya resueltas — esto no es asesoramiento de inversión.',
    tabs: { model: 'Modelo', camp: 'Bloque', tier: 'Nivel', category: 'Categoría' },
    campHeadline: 'EE. UU. vs China',
    columns: { rank: '#', name: 'Nombre', winRate: 'Tasa de acierto', sample: 'Muestra' },
    sampleCount: (n) => `${n} resueltas`,
    provisionalBadge: 'Provisional',
    provisionalNote: 'Provisional = menos de 10 predicciones resueltas. Tómalo como una señal temprana, no como un resultado consolidado.',
    emptyState: 'Todavía no hay suficientes predicciones resueltas — vuelve a revisar a medida que se resuelvan más rondas.',
    asOf: (date) => `Actualizado al ${date}`,
  },
  recordRoom: {
    title: 'Sala de registros',
    subtitle: 'Todas las rondas resueltas, con el resultado real y la respuesta de cada modelo. Solo lectura, inmutable.',
    outcomeLabel: 'Resultado real',
    resolvedAtLabel: 'Resuelto el',
    modelsScore: (correct, total) => `${correct}/${total} acertados`,
    correct: 'Acertó',
    incorrect: 'Falló',
    ungraded: 'Sin calificar',
    emptyState: 'Todavía no se ha resuelto ninguna ronda.',
    pagination: { prev: 'Anterior', next: 'Siguiente', pageOf: (page, totalPages) => `Página ${page} de ${totalPages}` },
  },
  hub: {
    title: 'Liga de predicción de IA',
    subtitle: 'Lo que predicen los modelos de IA del mundo \u2014 y con qué frecuencia acertaron.',
    tabs: { cards: 'Tarjetas', leaderboard: 'Tabla', recordRoom: 'Registros' },
    loading: 'Cargando\u2026',
    noInstruments: 'La liga todavía no está disponible en tu región.',
    generateLive: (credits) => `Preguntar a los modelos ahora \u00b7 ${credits} créditos`,
    generating: 'Consultando a los modelos\u2026',
    freeReadNote: 'Ver las tarjetas, la tabla y la sala de registros es gratis. Solo una ejecución en vivo consume créditos.',
    insufficientCredits: (required, balance) => `Una ejecución en vivo cuesta ${required} créditos \u2014 tienes ${balance}.`,
    rateLimited: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
    genericError: 'Algo salió mal. Inténtalo de nuevo.',
    balance: (credits) => `${credits} créditos`,
  },
}

const ar: LeagueUiPack = {
  direction: {
    badge: { up: 'صعود', down: 'هبوط', flat: 'استقرار' },
    noCallBadge: 'بلا رأي',
    tally: { up: 'صعود', down: 'هبوط', flat: 'استقرار' },
    noCallTally: 'بلا رأي',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: 'الصعود', down: 'الهبوط', flat: 'الاستقرار' }[dir]
      const suffix = conf !== null ? ` · متوسط الثقة ${Math.round(conf)}%` : ''
      return `${count} من أصل ${total} من نماذج الذكاء الاصطناعي يميل رأيها إلى ${word}${suffix}`
    },
    allAbstain: (total) => `امتنعت جميع نماذج الذكاء الاصطناعي البالغ عددها ${total} عن إبداء رأي في هذه الجولة`,
    split: (responded, total) => `أجاب ${responded} من أصل ${total} من نماذج الذكاء الاصطناعي، لكن الآراء منقسمة — لا يوجد اتجاه واضح`,
    none: 'لم يستجب أي نموذج ذكاء اصطناعي لهذه الجولة بعد',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`${tally.up} صعود`)
    if (tally.down) parts.push(`${tally.down} هبوط`)
    if (tally.flat) parts.push(`${tally.flat} استقرار`)
    if (tally.abstain) parts.push(`${tally.abstain} بلا رأي`)
    return `${label}: ${parts.length ? parts.join(' · ') : 'لا توجد إجابات بعد'}`
  },
  disclaimer: {
    short: 'لأغراض المعلومات فقط، وليست نصيحة استثمارية. أنت المسؤول عن قراراتك الخاصة.',
    long: 'يعرض هذا المحتوى آراء عدة نماذج ذكاء اصطناعي لأغراض المعلومات والترفيه فقط. وهو لا يمثل نصيحة استثمارية أو مالية أو قانونية أو مهنية، وليس أي نموذج هنا مستشارًا مرخصًا. الأسواق غير قابلة للتنبؤ، وقد تخطئ نماذج الذكاء الاصطناعي، بل وتخطئ كثيرًا. أنت وحدك المسؤول عن أي قرار تتخذه بناءً على ذلك.',
  },
  hitRate: { pending: 'معدل الإصابة: قيد الحساب', pct: (pct) => `معدل الإصابة ${pct}%` },
  modelList: {
    title: (n) => `النماذج (${n})`,
    tierTab: 'الفئة',
    campTab: 'المعسكر',
    empty: 'لم يستجب أي نموذج بعد.',
    correct: 'إصابة',
    missed: 'خطأ',
  },
  bracket: {
    finalVerdict: 'الحكم النهائي',
    division: {
      premier: 'الأولى · PREMIER',
      challenger: 'الثانية · CHALLENGER',
      world: 'الثالثة · WORLD',
      scout: 'SCOUT',
    },
    compactTally,
    showReasoning: 'عرض السبب',
    hideReasoning: 'إخفاء السبب',
    confidence: 'الثقة',
    resultLegend: '✓ صحيح — توقّع الذكاء الاصطناعي طابق النتيجة الفعلية · ✗ خاطئ — لم يطابقها. يُعرض فقط بعد حسم الجولة.',
  },
  gating: {
    unavailable: 'فئة التوقعات هذه غير متاحة بعد في منطقتك.',
    tosNote: 'يعتمد الظهور على الدولة المسجَّلة في حسابك والموقع المكتشَف لاتصالك. يجب عليك استخدام نطاقك القضائي الحقيقي؛ وإذا حاولت تجاوز ذلك (عبر VPN مثلاً) فإنك تتحمل مسؤولية أي نتائج تترتب على ذلك.',
  },
  languageToggleLabel: 'اللغة',
  leaderboard: {
    title: 'لوحة الصدارة',
    subtitle: 'معدلات الإصابة محسوبة فقط من التوقعات التي تم حسمها — هذه ليست نصيحة استثمارية.',
    tabs: { model: 'النموذج', camp: 'المعسكر', tier: 'الفئة', category: 'التصنيف' },
    campHeadline: 'الولايات المتحدة مقابل الصين',
    columns: { rank: '#', name: 'الاسم', winRate: 'معدل الإصابة', sample: 'حجم العينة' },
    sampleCount: (n) => `${n} تم حسمها`,
    provisionalBadge: 'مؤقت',
    provisionalNote: 'مؤقت = أقل من 10 توقعات محسومة. اعتبر هذه المعدلات إشارة مبكرة وليست سجلًا نهائيًا.',
    emptyState: 'لا توجد توقعات محسومة كافية بعد — عد لاحقًا مع حسم المزيد من الجولات.',
    asOf: (date) => `اعتبارًا من ${date}`,
  },
  recordRoom: {
    title: 'غرفة السجلات',
    subtitle: 'كل جولة تم حسمها، مع النتيجة الفعلية وتوقع كل نموذج. للعرض فقط ولا يمكن تعديلها.',
    outcomeLabel: 'النتيجة الفعلية',
    resolvedAtLabel: 'تاريخ الحسم',
    modelsScore: (correct, total) => `${correct} من أصل ${total} إصابة`,
    correct: 'إصابة',
    incorrect: 'خطأ',
    ungraded: 'غير مُقيَّم',
    emptyState: 'لم يتم حسم أي جولة بعد.',
    pagination: { prev: 'السابق', next: 'التالي', pageOf: (page, totalPages) => `صفحة ${page} من ${totalPages}` },
  },
  hub: {
    title: 'دوري التوقعات بالذكاء الاصطناعي',
    subtitle: 'ما تتوقعه نماذج الذكاء الاصطناعي حول العالم — ومدى دقتها فعليًا.',
    tabs: { cards: 'البطاقات', leaderboard: 'لوحة الصدارة', recordRoom: 'غرفة السجلات' },
    loading: 'جارٍ التحميل…',
    noInstruments: 'الدوري غير متاح بعد في منطقتك.',
    generateLive: (credits) => `اسأل النماذج الآن · ${credits} رصيد`,
    generating: 'جارٍ سؤال النماذج…',
    freeReadNote: 'تصفح البطاقات ولوحة الصدارة وغرفة السجلات مجاني. التشغيل المباشر وحده هو ما يستهلك الرصيد.',
    insufficientCredits: (required, balance) => `يتطلب التشغيل المباشر ${required} من الرصيد — لديك ${balance}.`,
    rateLimited: 'طلبات كثيرة جدًا. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى.',
    genericError: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
    balance: (credits) => `${credits} رصيد`,
  },
}

/** Structural stub — Brazil scope is intentionally deferred. Spreads English so the shape is always complete. */
const pt: LeagueUiPack = { ...en }

export const LEAGUE_UI: Record<LeagueLocale, LeagueUiPack> = { en, ko, ja, 'zh-TW': zhTW, fr, ar, es, pt }

export function getLeagueUiPack(locale: LeagueLocale): LeagueUiPack {
  return LEAGUE_UI[locale] ?? LEAGUE_UI.en
}
