import { lensDisplayLabel } from '../analysis-lenses'
import type { PublicCategoryId } from '../catalog'
import type { LeagueUiPack } from '../i18n/dictionary'
import type { LeaderboardBoardCopy } from '../i18n/leaderboard-board-copy'
import type { LeagueLocale } from '../i18n/locales'
import { formatWinRatePct } from '../win-rate'
import { extraSeatCopy } from './extra-copy'
import { companyLabel, modelLabelOf } from './model-meta'
import type { BoardRate, HighlightCard } from './types'

/**
 * Board figures and labels (pure, client-safe). A rate with no percentage
 * never prints a number with a percent sign: it prints the sample instead.
 */

export type RateTextKind = 'pct' | 'insufficient' | 'empty'

export type RateText = { kind: RateTextKind; text: string }

/**
 * `pooled` rates count calls across many seats; their gate and the "(n판)"
 * figure are distinct rounds, with the call count beside it.
 */
export function rateText(rate: BoardRate, copy: LeaderboardBoardCopy, opts: { pooled?: boolean } = {}): RateText {
  if (rate.n <= 0) return { kind: 'empty', text: copy.noData }
  if (rate.pct === null) return { kind: 'insufficient', text: copy.insufficient(opts.pooled ? rate.rounds : rate.n) }
  const pct = formatWinRatePct(rate.pct)
  if (opts.pooled && rate.n !== rate.rounds) return { kind: 'pct', text: copy.ratePooled(pct, rate.rounds, rate.n) }
  return { kind: 'pct', text: copy.rateRounds(pct, rate.n) }
}

const PUBLIC_OF_LEDGER: Record<string, PublicCategoryId> = {
  stock: 'stocks',
  stocks: 'stocks',
  crypto_spot: 'crypto',
  crypto: 'crypto',
  fx: 'fx',
  gold_metal: 'gold_metals',
  gold_metals: 'gold_metals',
  etf_index: 'index_etf',
  index_etf: 'index_etf',
  commodity_energy: 'commodities_energy',
  commodities_energy: 'commodities_energy',
  memecoin: 'memecoin',
  politics_election: 'politics_election',
  entertainment_awards: 'entertainment',
  entertainment: 'entertainment',
  sports: 'sports',
  real_estate: 'real_estate',
  tech: 'tech',
  ai_models: 'ai_ranking',
}

export function publicCategoryOfLedger(key: string): PublicCategoryId | null {
  return PUBLIC_OF_LEDGER[key] ?? null
}

export type BoardLabels = {
  category: (key: string) => string
  horizon: (key: string) => string
  model: (modelId: string) => string
  company: (key: string) => string
  lens: (key: string) => string
  camp: (key: string) => string
  tier: (key: string) => string
  book: (key: string) => string
  weights: (key: string) => string
  share: (key: string) => string
  confidence: (key: string) => string
  highlightTitle: (card: HighlightCard) => string
  highlightSide: (card: HighlightCard, key: string) => string
}

export function boardLabels(locale: LeagueLocale, t: LeagueUiPack, copy: LeaderboardBoardCopy): BoardLabels {
  const lookup = <T extends Record<string, string>>(table: T, key: string): string =>
    (table as Record<string, string>)[key] ?? key
  const model = (modelId: string) => extraSeatCopy(locale, modelId)?.name ?? modelLabelOf(modelId)
  const camp = (key: string) => lookup(t.leaderboard.campLabels, key)
  const book = (key: string) =>
    key === 'reasoning'
      ? t.leaderboard.methodLabels.pure_reasoning
      : key === 'search'
        ? t.leaderboard.methodLabels.research
        : key
  return {
    category: (key) => {
      const pub = PUBLIC_OF_LEDGER[key]
      return (pub && t.catalog.categories[pub]) || lookup(copy.categories, key)
    },
    horizon: (key) => lookup(t.catalog.horizons, key),
    model,
    company: companyLabel,
    lens: (key) => lensDisplayLabel(locale, key) ?? key,
    camp,
    tier: (key) => lookup(t.verdict.tierLabels, key),
    book,
    weights: (key) => lookup(t.leaderboard.weightLabels, key),
    share: (key) => lookup(copy.battle.shareBuckets, key),
    confidence: (key) => lookup(copy.battle.confidenceBuckets, key),
    highlightTitle: (card) => {
      if (card.id === 'camp') return copy.highlights.camp
      if (card.id === 'divination') return copy.highlights.divination(model('divination'))
      if (card.id === 'siblings') return copy.highlights.siblings(companyLabel(card.company ?? ''))
      return copy.highlights.method
    },
    highlightSide: (card, key) => {
      if (card.id === 'camp') return camp(key)
      if (card.id === 'divination') return key === 'ai' ? copy.ai : model(key)
      if (card.id === 'method') return book(key)
      return key
    },
  }
}
