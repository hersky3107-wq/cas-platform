/**
 * One analysis lens per official or scout seat, rotated by round id so the
 * same model does not always start from the same question. The lens is a
 * starting point. The seat still reads the whole packet and may agree with
 * the other seats. Extras are not assigned a lens.
 */

import type { LeagueLocale } from './i18n/locales'
import { LEAGUE_ROSTER } from './roster'

export const ANALYSIS_LENS_HEADER = 'ANALYSIS LENS:'

export const FINANCE_LENS_IDS = [
  'trend_momentum',
  'mean_reversion',
  'flows_positioning',
  'fundamentals_valuation',
  'macro_sector',
  'event_catalyst',
  'base_rate_statistician',
  'risk_review',
] as const

export const SPORTS_LENS_IDS = [
  'form',
  'matchup_h2h',
  'injuries_lineups',
  'home_schedule',
  'base_rate_statistician',
  'risk_review',
] as const

export const POLITICS_LENS_IDS = [
  'race_baseline',
  'news_events',
  'endorsements',
  'turnout_rules',
  'base_rate_statistician',
  'risk_review',
] as const

export const TECH_LENS_IDS = [
  'prior_releases',
  'competing_signals',
  'calendar_window',
  'official_sources',
  'base_rate_statistician',
  'risk_review',
] as const

export const ENTERTAINMENT_LENS_IDS = [
  'precursor_awards',
  'campaign_visibility',
  'winner_profile',
  'release_tracking',
  'base_rate_statistician',
  'risk_review',
] as const

export const HOUSING_LENS_IDS = [
  'price_trend',
  'transaction_volume',
  'supply_pipeline',
  'seasonality',
  'base_rate_statistician',
  'risk_review',
] as const

export const AIRANK_LENS_IDS = [
  'rank_trend',
  'score_gap',
  'release_calendar',
  'category_mix',
  'base_rate_statistician',
  'risk_review',
] as const

export type AnalysisLensId =
  | (typeof FINANCE_LENS_IDS)[number]
  | (typeof SPORTS_LENS_IDS)[number]
  | (typeof POLITICS_LENS_IDS)[number]
  | (typeof TECH_LENS_IDS)[number]
  | (typeof ENTERTAINMENT_LENS_IDS)[number]
  | (typeof HOUSING_LENS_IDS)[number]
  | (typeof AIRANK_LENS_IDS)[number]

export type AnalysisLens = {
  id: AnalysisLensId
  /** English name used in the model prompt. */
  en: string
  /** What this seat reads first. Risk review is not an order to disagree. */
  instruction: string
}

const LENS: Record<AnalysisLensId, AnalysisLens> = {
  trend_momentum: {
    id: 'trend_momentum',
    en: 'trend/momentum',
    instruction: 'Start with trend and momentum: the direction and persistence of the recent move.',
  },
  mean_reversion: {
    id: 'mean_reversion',
    en: 'mean-reversion/overextension',
    instruction: 'Start with mean-reversion and overextension: how stretched the recent move is versus its own average.',
  },
  flows_positioning: {
    id: 'flows_positioning',
    en: 'flows & positioning',
    instruction: 'Start with flows and positioning: who is already long or short, and whether that crowd is extreme.',
  },
  fundamentals_valuation: {
    id: 'fundamentals_valuation',
    en: 'fundamentals/valuation',
    instruction: 'Start with fundamentals and valuation: whether the price already assumes the good or bad news.',
  },
  macro_sector: {
    id: 'macro_sector',
    en: 'macro & sector',
    instruction: 'Start with macro and sector: the backdrop this instrument trades with, not the instrument alone.',
  },
  event_catalyst: {
    id: 'event_catalyst',
    en: 'event/catalyst calendar',
    instruction: 'Start with the event and catalyst calendar inside this horizon: what is scheduled, and what is already priced.',
  },
  base_rate_statistician: {
    id: 'base_rate_statistician',
    en: 'base-rate statistician',
    instruction:
      'Start from the base rate, including the conditional base rate for the current state. Adjust only for evidence that this case differs from those past cases.',
  },
  risk_review: {
    id: 'risk_review',
    en: 'risk review',
    instruction:
      'Start with risk review: the single most plausible way the leading case fails. This is not contrarian for its own sake — agree when the risk is not supported.',
  },
  form: {
    id: 'form',
    en: 'form',
    instruction: 'Start with recent form: results and scoring run over the last several matches, not one highlight.',
  },
  matchup_h2h: {
    id: 'matchup_h2h',
    en: 'matchup/H2H',
    instruction: 'Start with the matchup and head-to-head: how these two sides have actually played each other.',
  },
  injuries_lineups: {
    id: 'injuries_lineups',
    en: 'injuries & lineups',
    instruction: 'Start with injuries and lineups: who is missing or returning, and whether that changes the side.',
  },
  home_schedule: {
    id: 'home_schedule',
    en: 'home/away & schedule',
    instruction: 'Start with home/away and the schedule: venue, rest, and travel inside this fixture.',
  },
  race_baseline: {
    id: 'race_baseline',
    en: 'race baseline',
    instruction:
      'Start from the race baseline already in the packet (prediction-market implied probability). Do not invent a poll or call it 지지율.',
  },
  news_events: {
    id: 'news_events',
    en: 'news & events',
    instruction: 'Start with news and events inside the window: withdrawals, debates, and documented reversals.',
  },
  endorsements: {
    id: 'endorsements',
    en: 'endorsements',
    instruction: 'Start with endorsements and coalition shifts that the packet actually records.',
  },
  turnout_rules: {
    id: 'turnout_rules',
    en: 'turnout & rules',
    instruction: 'Start with turnout and election rules: who can vote, and what would have to change for the baseline to move.',
  },
  prior_releases: {
    id: 'prior_releases',
    en: 'prior releases',
    instruction: 'Start with prior releases of this kind: what usually happened the last times a similar announcement was due.',
  },
  competing_signals: {
    id: 'competing_signals',
    en: 'competing signals',
    instruction: 'Start with competing public signals: which sources disagree, and which one the resolution rule will use.',
  },
  calendar_window: {
    id: 'calendar_window',
    en: 'calendar window',
    instruction: 'Start with the calendar window: the event has to fall inside the open and resolve dates, not merely be rumored.',
  },
  official_sources: {
    id: 'official_sources',
    en: 'official sources',
    instruction: 'Start with official sources: the page or filing the resolution rule names, not a recap.',
  },
  precursor_awards: {
    id: 'precursor_awards',
    en: 'precursor awards',
    instruction: 'Start with precursor awards that have already been given for this race.',
  },
  campaign_visibility: {
    id: 'campaign_visibility',
    en: 'campaign visibility',
    instruction: 'Start with campaign visibility: documented appearances and coverage, not a vibe.',
  },
  winner_profile: {
    id: 'winner_profile',
    en: 'historical winner profile',
    instruction: 'Start with the historical winner profile for this award: what past winners had in common.',
  },
  release_tracking: {
    id: 'release_tracking',
    en: 'release tracking',
    instruction: 'Start with published tracking (admissions, gross, or studio tracking) when the packet has it.',
  },
  price_trend: {
    id: 'price_trend',
    en: 'price trend',
    instruction: 'Start with the published index trend for this region, not a single complex.',
  },
  transaction_volume: {
    id: 'transaction_volume',
    en: 'transaction volume',
    instruction: 'Start with transaction volume: whether deals are increasing or drying up in this region.',
  },
  supply_pipeline: {
    id: 'supply_pipeline',
    en: 'supply',
    instruction: 'Start with supply: listings or new completions the packet actually measures for this region.',
  },
  seasonality: {
    id: 'seasonality',
    en: 'seasonality',
    instruction: 'Start with seasonality: the usual calendar pattern for this region and horizon.',
  },
  rank_trend: {
    id: 'rank_trend',
    en: 'rank trend',
    instruction: 'Start with the recent rank trend of the named brand on the public board.',
  },
  score_gap: {
    id: 'score_gap',
    en: 'score gap',
    instruction: 'Start with the score gap to the neighbor above and below.',
  },
  release_calendar: {
    id: 'release_calendar',
    en: 'release calendar',
    instruction: 'Start with model releases scheduled inside this horizon that could move the board.',
  },
  category_mix: {
    id: 'category_mix',
    en: 'category mix',
    instruction: 'Start with the category mix of the ranking (overall versus a slice) named in the proposition.',
  },
}

const FINANCE_CATEGORIES = new Set([
  'stock',
  'etf_index',
  'bond_rate',
  'gold_metal',
  'macro_econ',
  'commodity_energy',
  'crypto_spot',
  'fx',
  'futures_derivatives',
  'memecoin',
  'crypto_perps',
])

export function lensIdsForCategory(category: string | null | undefined): readonly AnalysisLensId[] {
  const key = (category ?? '').trim().toLowerCase()
  if (key === 'sports') return SPORTS_LENS_IDS
  if (key === 'politics_election') return POLITICS_LENS_IDS
  if (key === 'tech') return TECH_LENS_IDS
  if (key === 'entertainment_awards') return ENTERTAINMENT_LENS_IDS
  if (key === 'real_estate') return HOUSING_LENS_IDS
  if (key === 'ai_models') return AIRANK_LENS_IDS
  if (FINANCE_CATEGORIES.has(key)) return FINANCE_LENS_IDS
  return FINANCE_LENS_IDS
}

function hash32(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

let rosterOrder: readonly string[] | null = null

function officialSeatIndex(modelId: string, lensCount: number): number {
  if (!rosterOrder) rosterOrder = LEAGUE_ROSTER.map((entry) => entry.model_id)
  const index = rosterOrder.indexOf(modelId)
  if (index >= 0) return index
  return hash32(modelId) % lensCount
}

/** Stable lens for this seat on this round. Adjacent roster seats differ; the round id shifts every seat. */
export function analysisLensForSeat(args: {
  roundId: string
  category: string | null | undefined
  modelId: string
}): AnalysisLens {
  const ids = lensIdsForCategory(args.category)
  const seat = officialSeatIndex(args.modelId, ids.length)
  const offset = hash32(args.roundId) % ids.length
  const id = ids[(seat + offset) % ids.length]!
  return LENS[id]
}

export function withAnalysisLens(prompt: string, lens: AnalysisLens, opts: { scout: boolean }): string {
  const choose = opts.scout
    ? 'You have no closed-book packet. Start from this lens on the facts you gathered, weigh everything, then choose. Do not invent disagreement.'
    : 'Read the full packet. Start from this lens, weigh everything, then choose. Do not invent disagreement.'
  return [prompt, '', `${ANALYSIS_LENS_HEADER} ${lens.en}.`, lens.instruction, choose].join('\n')
}

const DISPLAY: Record<AnalysisLensId, Record<LeagueLocale, string>> = {
  trend_momentum: { en: 'trend/momentum', ko: '추세/모멘텀', ja: 'トレンド/モメンタム', 'zh-TW': '趨勢/動能', fr: 'tendance/momentum', es: 'tendencia/impulso', ar: 'الاتجاه/الزخم', pt: 'tendência/momentum' },
  mean_reversion: { en: 'mean-reversion/overextension', ko: '평균회귀/과열', ja: '平均回帰/過熱', 'zh-TW': '均值回歸/過熱', fr: 'retour à la moyenne', es: 'reversión a la media', ar: 'الرجوع للمتوسط/المبالغة', pt: 'reversão à média' },
  flows_positioning: { en: 'flows & positioning', ko: '수급·포지션', ja: '資金フロー/ポジション', 'zh-TW': '資金流/部位', fr: 'flux et positions', es: 'flujos y posiciones', ar: 'التدفقات والمراكز', pt: 'fluxos e posições' },
  fundamentals_valuation: { en: 'fundamentals/valuation', ko: '펀더멘털/밸류', ja: 'ファンダメンタル/バリュエーション', 'zh-TW': '基本面/估值', fr: 'fondamentaux/valorisation', es: 'fundamentos/valoración', ar: 'الأساسيات/التقييم', pt: 'fundamentos/avaliação' },
  macro_sector: { en: 'macro & sector', ko: '매크로·섹터', ja: 'マクロ/セクター', 'zh-TW': '總體與類股', fr: 'macro et secteur', es: 'macro y sector', ar: 'الاقتصاد الكلي والقطاع', pt: 'macro e setor' },
  event_catalyst: { en: 'event/catalyst calendar', ko: '이벤트/촉매', ja: 'イベント/材料', 'zh-TW': '事件/催化', fr: 'calendrier d’événements', es: 'calendario de catalizadores', ar: 'الحدث/المحفز', pt: 'evento/catalisador' },
  base_rate_statistician: { en: 'base-rate statistician', ko: '기저율', ja: 'ベースレート', 'zh-TW': '基準機率', fr: 'taux de base', es: 'tasa base', ar: 'المعدل الأساسي', pt: 'taxa-base' },
  risk_review: { en: 'risk review', ko: '리스크 검토', ja: 'リスク点検', 'zh-TW': '風險檢視', fr: 'revue des risques', es: 'revisión de riesgos', ar: 'مراجعة المخاطر', pt: 'revisão de risco' },
  form: { en: 'form', ko: '최근 폼', ja: '直近の調子', 'zh-TW': '近期狀態', fr: 'forme récente', es: 'forma reciente', ar: 'المستوى الأخير', pt: 'forma recente' },
  matchup_h2h: { en: 'matchup/H2H', ko: '상대전적', ja: '対戦相性', 'zh-TW': '對戰/交手', fr: 'confrontation', es: 'enfrentamiento', ar: 'المواجهة المباشرة', pt: 'confronto direto' },
  injuries_lineups: { en: 'injuries & lineups', ko: '부상·라인업', ja: '負傷/ラインアップ', 'zh-TW': '傷兵/先發', fr: 'blessures et compositions', es: 'bajas y alineaciones', ar: 'الإصابات والتشكيلة', pt: 'lesões e escalações' },
  home_schedule: { en: 'home/away & schedule', ko: '홈/원정·일정', ja: 'ホーム/アウェイと日程', 'zh-TW': '主客場/賽程', fr: 'domicile/extérieur', es: 'local/visita y calendario', ar: 'الأرض والجدول', pt: 'casa/fora e calendário' },
  race_baseline: { en: 'race baseline', ko: '판세 기준선', ja: 'レースの基準線', 'zh-TW': '選情基準', fr: 'base de la course', es: 'base de la carrera', ar: 'خط أساس السباق', pt: 'base da corrida' },
  news_events: { en: 'news & events', ko: '뉴스·이벤트', ja: 'ニュース/出来事', 'zh-TW': '新聞/事件', fr: 'actus et événements', es: 'noticias y eventos', ar: 'الأخبار والأحداث', pt: 'notícias e eventos' },
  endorsements: { en: 'endorsements', ko: '지지·연대', ja: '支持表明', 'zh-TW': '背書', fr: 'ralliements', es: 'respaldos', ar: 'التأييد', pt: 'apoios' },
  turnout_rules: { en: 'turnout & rules', ko: '투표율·규칙', ja: '投票率/規則', 'zh-TW': '投票率/規則', fr: 'participation et règles', es: 'participación y reglas', ar: 'الإقبال والقواعد', pt: 'comparecimento e regras' },
  prior_releases: { en: 'prior releases', ko: '과거 발표', ja: '過去の発表', 'zh-TW': '過往發布', fr: 'annonces passées', es: 'anuncios previos', ar: 'الإصدارات السابقة', pt: 'lançamentos anteriores' },
  competing_signals: { en: 'competing signals', ko: '상충 신호', ja: '対立する材料', 'zh-TW': '互相衝突的訊號', fr: 'signaux contradictoires', es: 'señales opuestas', ar: 'إشارات متعارضة', pt: 'sinais conflitantes' },
  calendar_window: { en: 'calendar window', ko: '일정 창', ja: '日程の窓', 'zh-TW': '時程窗口', fr: 'fenêtre du calendrier', es: 'ventana del calendario', ar: 'نافذة التقويم', pt: 'janela do calendário' },
  official_sources: { en: 'official sources', ko: '공식 출처', ja: '公式ソース', 'zh-TW': '官方來源', fr: 'sources officielles', es: 'fuentes oficiales', ar: 'المصادر الرسمية', pt: 'fontes oficiais' },
  precursor_awards: { en: 'precursor awards', ko: '전조 시상', ja: '前哨戦の賞', 'zh-TW': '前哨獎', fr: 'prix précurseurs', es: 'premios previos', ar: 'الجوائز التمهيدية', pt: 'prêmios precursores' },
  campaign_visibility: { en: 'campaign visibility', ko: '캠페인 노출', ja: 'キャンペーン露出', 'zh-TW': '宣傳曝光', fr: 'visibilité de campagne', es: 'visibilidad de campaña', ar: 'ظهور الحملة', pt: 'visibilidade da campanha' },
  winner_profile: { en: 'historical winner profile', ko: '과거 수상 프로필', ja: '過去の受賞者像', 'zh-TW': '歷屆得主輪廓', fr: 'profil des lauréats', es: 'perfil de ganadores', ar: 'ملف الفائزين السابقين', pt: 'perfil de vencedores' },
  release_tracking: { en: 'release tracking', ko: '흥행 트래킹', ja: '公開トラッキング', 'zh-TW': '票房追蹤', fr: 'suivi de sortie', es: 'seguimiento de estreno', ar: 'تتبع الإصدار', pt: 'rastreamento de estreia' },
  price_trend: { en: 'price trend', ko: '가격 추세', ja: '価格トレンド', 'zh-TW': '價格趨勢', fr: 'tendance des prix', es: 'tendencia de precios', ar: 'اتجاه السعر', pt: 'tendência de preço' },
  transaction_volume: { en: 'transaction volume', ko: '거래량', ja: '取引量', 'zh-TW': '交易量', fr: 'volume de transactions', es: 'volumen de operaciones', ar: 'حجم الصفقات', pt: 'volume de transações' },
  supply_pipeline: { en: 'supply', ko: '공급', ja: '供給', 'zh-TW': '供給', fr: 'offre', es: 'oferta', ar: 'العرض', pt: 'oferta' },
  seasonality: { en: 'seasonality', ko: '계절성', ja: '季節性', 'zh-TW': '季節性', fr: 'saisonnalité', es: 'estacionalidad', ar: 'الموسمية', pt: 'sazonalidade' },
  rank_trend: { en: 'rank trend', ko: '순위 추세', ja: '順位の推移', 'zh-TW': '排名趨勢', fr: 'tendance du classement', es: 'tendencia del ranking', ar: 'اتجاه الترتيب', pt: 'tendência do ranking' },
  score_gap: { en: 'score gap', ko: '점수 간격', ja: 'スコア差', 'zh-TW': '分數差距', fr: 'écart de score', es: 'brecha de puntuación', ar: 'فارق النقاط', pt: 'diferença de pontuação' },
  release_calendar: { en: 'release calendar', ko: '출시 일정', ja: 'リリース日程', 'zh-TW': '發布日程', fr: 'calendrier de sorties', es: 'calendario de lanzamientos', ar: 'تقويم الإصدارات', pt: 'calendário de lançamentos' },
  category_mix: { en: 'category mix', ko: '부문 구성', ja: 'カテゴリ構成', 'zh-TW': '項目組成', fr: 'mix des catégories', es: 'mezcla de categorías', ar: 'مزيج الفئات', pt: 'composição das categorias' },
}

export function lensDisplayLabel(locale: LeagueLocale, id: string | null | undefined): string | null {
  if (!id || !(id in DISPLAY)) return null
  return DISPLAY[id as AnalysisLensId][locale]
}
