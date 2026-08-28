import { computeRealizedVol, type ConsensusSnapshot, type CryptoSnapshot } from './closed-book-packet'

/**
 * Packet v2 (D) — DISPERSION-TRIGGERED RESEARCH BUDGET (pure).
 *
 * When the market itself is uncertain (analysts split, IV elevated, realized
 * vol high) the research step spends MORE; when consensus is tight it spends
 * LESS. The tier is decided BEFORE `getResearchPacket` runs — the
 * orchestrator fetches consensus/crypto context first (reordered for this).
 *
 * Tiers (from the 2026-08-28 accuracy-strategy report):
 *   tight  → 2 queries, no synthesis          (~$0.013 fresh)
 *   normal → 4 queries                        (~$0.03 fresh)
 *   high   → 10-12 sub-questions + synthesis  (~$0.09 fresh) — the
 *            Cassi-style decomposition, run ONCE per packet, shared by all.
 */

export type ResearchTier = 'tight' | 'normal' | 'high'

/** Equity: analyst target dispersion = (hi − lo) / anchor close, %. */
export const EQUITY_DISPERSION_TIGHT_MAX_PCT = 15
export const EQUITY_DISPERSION_HIGH_MIN_PCT = 30
/** Equity: buy-ish AND sell-ish both ≥ this share of ratings → analysts split → high. */
export const RECS_SPLIT_HIGH_MIN_PCT = 20
/** Crypto: Deribit mark IV, %. */
export const CRYPTO_IV_TIGHT_MAX_PCT = 40
export const CRYPTO_IV_HIGH_MIN_PCT = 70
/** FX/metals/commodities/everything else: 20-session annualized realized vol, %. */
export const RVOL_TIGHT_MAX_PCT = 8
export const RVOL_HIGH_MIN_PCT = 15

export type TierDecision = {
  tier: ResearchTier
  /** Human-auditable reason, e.g. "equity dispersion 34.2% >= 30%". */
  signal: string
}

const EQUITY_CATEGORIES = new Set(['stock', 'etf_index'])
const CRYPTO_CATEGORIES = new Set(['crypto_spot', 'crypto_perps', 'memecoin'])

function equityTier(consensus: ConsensusSnapshot, anchorClose: number | null): TierDecision | null {
  if ('unavailable' in consensus.priceTarget) return null
  const t = consensus.priceTarget
  const scale = anchorClose ?? t.current
  if (typeof scale !== 'number' || scale <= 0) return null
  const dispersionPct = ((t.high - t.low) / scale) * 100

  if (!('unavailable' in consensus.recommendations)) {
    const r = consensus.recommendations
    const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell
    if (total > 0) {
      const buyPct = ((r.strongBuy + r.buy) / total) * 100
      const sellPct = ((r.sell + r.strongSell) / total) * 100
      if (buyPct >= RECS_SPLIT_HIGH_MIN_PCT && sellPct >= RECS_SPLIT_HIGH_MIN_PCT) {
        return {
          tier: 'high',
          signal: `recommendations split: buy ${buyPct.toFixed(0)}% vs sell ${sellPct.toFixed(0)}% (both >= ${RECS_SPLIT_HIGH_MIN_PCT}%)`,
        }
      }
    }
  }

  if (dispersionPct >= EQUITY_DISPERSION_HIGH_MIN_PCT) {
    return { tier: 'high', signal: `equity target dispersion ${dispersionPct.toFixed(1)}% >= ${EQUITY_DISPERSION_HIGH_MIN_PCT}%` }
  }
  if (dispersionPct < EQUITY_DISPERSION_TIGHT_MAX_PCT) {
    return { tier: 'tight', signal: `equity target dispersion ${dispersionPct.toFixed(1)}% < ${EQUITY_DISPERSION_TIGHT_MAX_PCT}%` }
  }
  return { tier: 'normal', signal: `equity target dispersion ${dispersionPct.toFixed(1)}% in [${EQUITY_DISPERSION_TIGHT_MAX_PCT}, ${EQUITY_DISPERSION_HIGH_MIN_PCT})` }
}

function cryptoTier(crypto: CryptoSnapshot): TierDecision | null {
  if ('unavailable' in crypto.markIv) return null
  const iv = crypto.markIv.ivPct
  if (iv >= CRYPTO_IV_HIGH_MIN_PCT) return { tier: 'high', signal: `crypto mark IV ${iv.toFixed(1)}% >= ${CRYPTO_IV_HIGH_MIN_PCT}%` }
  if (iv < CRYPTO_IV_TIGHT_MAX_PCT) return { tier: 'tight', signal: `crypto mark IV ${iv.toFixed(1)}% < ${CRYPTO_IV_TIGHT_MAX_PCT}%` }
  return { tier: 'normal', signal: `crypto mark IV ${iv.toFixed(1)}% in [${CRYPTO_IV_TIGHT_MAX_PCT}, ${CRYPTO_IV_HIGH_MIN_PCT})` }
}

function rvolTier(closes: readonly number[]): TierDecision | null {
  const vol = computeRealizedVol([...closes], 20)
  if (vol == null) return null
  const volPct = vol * 100
  if (volPct >= RVOL_HIGH_MIN_PCT) return { tier: 'high', signal: `realized vol ${volPct.toFixed(1)}% >= ${RVOL_HIGH_MIN_PCT}%` }
  if (volPct < RVOL_TIGHT_MAX_PCT) return { tier: 'tight', signal: `realized vol ${volPct.toFixed(1)}% < ${RVOL_TIGHT_MAX_PCT}%` }
  return { tier: 'normal', signal: `realized vol ${volPct.toFixed(1)}% in [${RVOL_TIGHT_MAX_PCT}, ${RVOL_HIGH_MIN_PCT})` }
}

/**
 * Decide the research tier for a round from whatever uncertainty signal the
 * category exposes. Missing signals degrade to 'normal' — never a guess.
 */
export function decideResearchTier(args: {
  category: string
  consensus: ConsensusSnapshot | null
  crypto: CryptoSnapshot | null
  closes: readonly number[]
  anchorClose: number | null
}): TierDecision {
  const { category, consensus, crypto, closes, anchorClose } = args

  if (EQUITY_CATEGORIES.has(category) && consensus) {
    const d = equityTier(consensus, anchorClose)
    if (d) return d
  }
  if (CRYPTO_CATEGORIES.has(category) && crypto) {
    const d = cryptoTier(crypto)
    if (d) return d
  }
  const d = rvolTier(closes)
  if (d) return d

  return { tier: 'normal', signal: 'no uncertainty signal available — default' }
}
