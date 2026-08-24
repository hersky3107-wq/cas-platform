import type { DirectionTally, LeagueTier } from '../card-types'
import type { PublicCategoryId } from '../catalog'
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
    /**
     * Shown under any figure that collapses one round into a single number
     * ("29 of 40 lean up"). Tiers 1–3 share one research packet, so those
     * calls are correlated — the UI must not imply 40 independent forecasts.
     */
    correlatedNote: string
  }
  /** e.g. "US: 3 up · 1 down · 1 no call" — `label` (e.g. "US"/"Premier") is passed through untranslated (a proper-noun-ish group name). */
  groupTallyLine: (label: string, tally: DirectionTally) => string
  disclaimer: {
    short: string
    long: string
    /** Extra line ONLY on real_estate cards — statistical reference, not an appraisal. */
    realEstate: string
  }
  /**
   * Cards-tab Category → Instrument nav. Keys are catalog ids / instrument
   * symbols from `lib/league/catalog.ts` — never shown as raw enum keys.
   */
  catalog: {
    categories: Record<PublicCategoryId, string>
    instruments: Record<string, string>
    comingSoon: string
    comingSoonHint: string
    /** Academic framing for the macro_econ coming-soon panel. */
    macroEconHint: string
    noCardYet: string
  }
  /**
   * Card accuracy badge. `withValue` receives an ALREADY-COMPOSED figure from
   * `lib/league/win-rate.ts` — either "62% (n=40)" or a raw record like
   * "1W 0L (sample too small)". Locales must not build the percentage
   * themselves: that is the only way the minimum-sample rule and the
   * "never a percentage without its n" rule hold in all 8 languages.
   */
  hitRate: {
    pending: string
    withValue: (value: string) => string
    /** One round is a result, not a rate — e.g. "This round: 27/37 correct". */
    roundResult: (correct: number, graded: number) => string
  }
  /**
   * WIN-RATE FIGURES — the regulated numbers. Every accuracy percentage in the
   * product is assembled by exactly one of these, via
   * `lib/league/win-rate.ts`'s `winRateLabel`.
   *
   * `withSample` MUST keep the percentage and its n in the same string: a
   * component cannot then place n somewhere quieter or drop it. Below the
   * minimum sample there is no percentage to translate at all — `insufficient`
   * takes wins and losses, never a rate.
   */
  winRate: {
    /** e.g. "62% (n=34)". Percentage is pre-truncated; never re-round it. */
    withSample: (pctText: string, n: number) => string
    /** Raw record, e.g. "34W 12L" — used where a rate is shown alongside. */
    record: (wins: number, losses: number) => string
    /** Raw record + an explicit low-sample note, e.g. "1W 0L (sample too small)". NO percentage. */
    insufficient: (wins: number, losses: number) => string
    /** The low-sample note alone — for layouts that already show the record in an adjacent column. */
    insufficientNote: string
    /** States when ranking starts, so an unranked list does not look broken. */
    rankingBegins: (minSample: number) => string
    /** Nothing graded yet for this bucket. */
    noRounds: string
  }
  /**
   * GRADING-STATE chrome. A round with no result is not one thing: its deadline
   * may not have passed, grading may be running right now, or grading may have
   * been attempted and refused (e.g. the close came out exactly equal, so no
   * up/down call can be right). The card says which — an empty result with no
   * explanation is what makes a track record look edited.
   *
   * `unresolvableNote` must NOT blame the user or imply a pending fix; it states
   * plainly that this round scores nobody.
   */
  grading: {
    /** Deadline passed, grading is running now (badge). */
    inProgress: string
    /** Deadline passed, grading has not run yet (badge). */
    pending: string
    /** Deadline passed and this round cannot be graded (badge). */
    unresolvable: string
    /** One line explaining that nobody was scored on this round. */
    unresolvableNote: string
    /** A genuine in-flight grade that did not land after ~60s of polling. */
    stalled: string
    stalledNote: string
    /** Plain-language reasons — keyed to `UnresolvableReason`. */
    reason: {
      missing_anchor: string
      invalid_window: string
      series_unavailable: string
      no_series_data: string
      no_session_in_window: string
      equal_close: string
      not_price_instrument: string
      unknown: string
    }
  }
  /**
   * Card header price chrome. The $ amount and its date/time are formatted
   * by the component (locale-agnostic number/date formatting, same
   * convention as `RecordRoomBody`'s `toLocaleString()`), NOT here — these
   * three strings are only the connector words around those numbers, e.g.
   * "$305.59 {atPrediction} · Aug 18, 12:44" and "{live} $306.10 · {now}".
   */
  header: {
    /** e.g. "at prediction" — labels the ANCHOR price (round-open price). */
    atPrediction: string
    /** e.g. "now" — labels the optional live/current price. */
    now: string
    /** Small badge word next to the optional live price, e.g. "LIVE". */
    live: string
    /** One-line header when the starting price is on the row. */
    headlineWithAnchor: (today: string, instrument: string, price: string, anchorDate: string) => string
    /** One-line header when the starting price was never recorded. */
    headlineNoAnchor: (today: string, instrument: string) => string
    /** Window sentence when both ends of the window are known. */
    windowWithAnchor: (fromDate: string, fromPrice: string, toDate: string) => string
    /** Window sentence for a graded round — both session dates AND the resolution close price are known. */
    windowResolved: (fromDate: string, fromPrice: string, toDate: string, toPrice: string) => string
    /** Anchor session known, resolution session not yet recorded. */
    windowAnchorOnly: (fromDate: string, fromPrice: string) => string
    /** Price exists but neither session date is persisted — do not invent dates. */
    windowNoSessionDates: string
    /** Window sentence when there is no persisted starting price. */
    windowNoAnchor: string
    /** Connector for the secondary live quote, only shown once an anchor exists. */
    liveSecondary: string
  }
  modelList: {
    title: (count: number) => string
    tierTab: string
    campTab: string
    empty: string
    correct: string
    missed: string
    /** Direction present, round graded, but this row has no is_correct. */
    ungraded: string
  }
  /** Per-model tile chrome (brand + roster slot id). */
  modelTile: {
    /** Accessible label prefix for the monospace model id line. */
    modelLabel: string
    /** Short expand control on a collapsed tile that has a rationale. */
    showWhy: string
    /** Short collapse control once the rationale is open. */
    hideWhy: string
    /** Toggle: show the stored English original next to a translation. */
    showOriginal: string
    hideOriginal: string
    originalLabel: string
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
    /**
     * Citation-style past accuracy of the 40-model majority-vote method. Always
     * carries n. `pctText` arrives pre-truncated from `win-rate.ts` and only
     * exists once the minimum sample is met.
     */
    combinedTrack: (pctText: string, n: number) => string
    /** Shown when the combined method has no resolved majority-vote rounds yet. */
    combinedTrackPending: string
  }
  /**
   * Final-verdict panel (raw counts only — see `lib/league/verdict-aggregate.ts`).
   * No percentage templates live here; the hero line is always "hits/graded".
   */
  verdict: {
    title: string
    /** e.g. "This round 29/40 hit". */
    heroHits: (hits: number, graded: number) => string
    distributionUp: string
    distributionDown: string
    distributionNoDirection: string
    sectionCamp: string
    sectionTier: string
    sectionBook: string
    sectionCountry: string
    /** One-line caution under the country section. */
    sectionCountryCaution: string
    sectionOverconfident: string
    sectionStreaks: string
    campLabels: { us: string; china: string; other: string }
    tierLabels: { premier: string; challenger: string; world: string; scout: string }
    bookLabels: { closed: string; scout: string }
    countryLabels: { US: string; CN: string; KR: string; FR: string; CA: string; INT: string }
    /** "18/25" style — hits over graded. */
    rawCount: (hits: number, graded: number) => string
    /** Ungraded count when > 0, e.g. "+3 unscored". */
    ungradedNote: (ungraded: number) => string
    overconfidentConfidence: (confidence: number) => string
    streakLine: (label: string, streak: number) => string
    expandSection: string
    collapseSection: string
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
    /** Secondary-tab strip (primary views sit above, always visible). */
    tabs: { camp3: string; tier: string; brand: string; category: string; korea: string }
    moreComparisons: string
    hideComparisons: string
    /** Headline label above the US vs China comparison. */
    campHeadline: string
    /** Headline label above PURE-REASONING vs RESEARCH. */
    methodHeadline: string
    methodLabels: { pure_reasoning: string; research: string }
    campLabels: { us: string; china: string; other: string }
    columns: { rank: string; name: string; winRate: string; record: string }
    /**
     * Round-level disclosure under the table: how many rounds these win rates
     * were computed from, and how many could not be graded. Always rendered when
     * anything is unresolvable — hiding it would make the record look cleaner
     * than it is.
     */
    roundCoverage: (graded: number, unresolvable: number) => string
    emptyState: string
    asOf: (date: string) => string
    /** Section label above Always up / Coin flip. */
    baselinesTitle: string
    /** States that baselines are not participants and are not ranked. */
    baselinesNote: string
    baselineBadge: string
    alwaysUp: string
    alwaysUpHint: string
    coinFlip: string
    coinFlipHint: string
    /** Record-column filler for the coin-flip marker (it has no W/L). */
    coinFlipRecord: string
    /** The honest headline: how many models beat Always up. */
    beatingAlwaysUp: (beating: number, compared: number) => string
    beatingAlwaysUpEmpty: string
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
    /** States that the recent view is free. */
    freeNote: string
    /** Paid CTA — MUST carry its price. */
    deepCta: (credits: number) => string
    deepUnlocking: string
    exportCsv: string
    filterModel: string
    filterFrom: string
    filterTo: string
    applyFilters: string
    headlineRecent: (correct: number, graded: number) => string
    latestRound: (instrument: string, outcome: string) => string
    insufficientCredits: (required: number, balance: number) => string
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
    /** Paid CTA — MUST carry its price. Open-ended deep analysis of the current round. */
    deepOpen: (credits: number) => string
    /** Paid CTA — MUST carry its price. Pro/con debate of the current round. */
    deepDebate: (credits: number) => string
    deepRunning: string
    /** Distinguishes this output from the scored prediction league. */
    deepUnscoredNote: string
    deepOpenTitle: string
    deepDebateTitle: string
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
    correlatedNote:
      'Premier, Challenger and World all read the same research packet, so this is one event with correlated inputs — not 40 independent forecasts.',
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
    realEstate:
      'Statistical reference only — not a formal appraisal. Region- and instrument-level outlook; not a valuation of any specific property.',
  },
  catalog: {
    categories: {
      sports: 'Sports',
      crypto: 'Crypto',
      stocks: 'Stocks',
      fx: 'FX',
      gold_metals: 'Gold & metals',
      index_etf: 'Index / ETF',
      commodities_energy: 'Commodities & energy',
      politics_election: 'Politics',
      entertainment: 'Entertainment',
      memecoin: 'Memecoin',
      real_estate: 'Real estate',
      macro_econ: 'Macro',
    },
    instruments: {
      AAPL: 'Apple (AAPL)',
      NVDA: 'NVIDIA (NVDA)',
      TSLA: 'Tesla (TSLA)',
      'BTC/USD': 'Bitcoin (BTC)',
      'ETH/USD': 'Ethereum (ETH)',
      'SOL/USD': 'Solana (SOL)',
      'EUR/USD': 'Euro / US Dollar',
      'USD/KRW': 'US Dollar / Korean Won',
      'USD/JPY': 'US Dollar / Japanese Yen',
      'XAU/USD': 'Gold',
      'XAG/USD': 'Silver',
      SPX: 'S&P 500',
      NDX: 'Nasdaq 100',
      'WTICO/USD': 'WTI Crude',
      'NATGAS/USD': 'Natural Gas',
      VNQ: 'Vanguard Real Estate (VNQ)',
      SCHH: 'Schwab US REIT (SCHH)',
      'DOGE/USD': 'Dogecoin (DOGE)',
      'SHIB/USD': 'Shiba Inu (SHIB)',
    },
    comingSoon: 'Coming soon',
    comingSoonHint: 'Event picker and prompt-search will live here. No fixed instruments for this category.',
    macroEconHint: 'Expert market outlook — rates, inflation, bonds. Depth, not dopamine.',
    noCardYet: 'No prediction card for this instrument yet.',
  },
  hitRate: {
    pending: 'Hit rate: pending',
    withValue: (value) => `${value} hit rate`,
    roundResult: (correct, graded) => `This round: ${correct}/${graded} correct`,
  },
  winRate: {
    withSample: (pctText, n) => `${pctText}% (n=${n})`,
    record: (wins, losses) => `${wins}W ${losses}L`,
    insufficient: (wins, losses) => `${wins}W ${losses}L (sample too small)`,
    insufficientNote: 'Sample too small',
    rankingBegins: (minSample) =>
      `Ranking starts after ${minSample} graded rounds. Until then these are shown unranked, with the raw record instead of a percentage.`,
    noRounds: 'No graded rounds yet',
  },
  grading: {
    inProgress: 'Grading\u2026',
    pending: 'Awaiting grading',
    unresolvable: 'Cannot be graded',
    unresolvableNote:
      'The deadline passed, but this round cannot be graded fairly \u2014 so no model was scored on it, and it counts for nobody.',
    stalled: 'Grading did not finish',
    stalledNote: 'A grade was started but no result arrived. Refresh later, or apply the missing baseline if this round has none.',
    reason: {
      missing_anchor: 'No starting price was recorded for this round, so it cannot be scored.',
      invalid_window: 'The start and end times of this round do not make a usable window.',
      series_unavailable: 'The historical price series could not be fetched, so nobody was scored.',
      no_series_data: 'The price feed returned no usable closes for this window.',
      no_session_in_window: 'No market session closed inside this prediction window (weekend or holiday).',
      equal_close: 'The close matched the starting price exactly, so nobody is right or wrong.',
      not_price_instrument: 'This instrument is not a market price, so it cannot be scored this way.',
      unknown: 'This round cannot be scored, so it counts for nobody.',
    },
  },
  header: {
    atPrediction: 'at prediction',
    now: 'now',
    live: 'LIVE',
    headlineWithAnchor: (today, instrument, price, anchorDate) =>
      `${today} \u00b7 ${instrument} \u00b7 ${price}${anchorDate ? ` (${anchorDate})` : ''}`,
    headlineNoAnchor: (today, instrument) => `${today} \u00b7 ${instrument} \u00b7 starting price unavailable`,
    windowWithAnchor: (fromDate, fromPrice, toDate) =>
      `Measured from the ${fromDate} close of ${fromPrice}, resolving against the ${toDate} close.`,
    windowResolved: (fromDate, fromPrice, toDate, toPrice) =>
      `Measured from the ${fromDate} close of ${fromPrice}, resolved against the ${toDate} close of ${toPrice}.`,
    windowAnchorOnly: (fromDate, fromPrice) =>
      `Measured from the ${fromDate} close of ${fromPrice}. The resolving session is not recorded yet.`,
    windowNoSessionDates:
      'The starting price is recorded, but the session dates for this prediction are not — those dates are not inferred from timestamps.',
    windowNoAnchor:
      'The starting price for this prediction was not recorded, so a live quote is not shown \u2014 it would be the wrong number to read these calls against.',
    liveSecondary: 'now',
  },
  modelList: {
    title: (n) => `Models (${n})`,
    tierTab: 'Tier',
    campTab: 'Camp',
    empty: 'No models have reported yet.',
    correct: 'Correct',
    missed: 'Missed',
    ungraded: 'Not scored',
  },
  modelTile: {
    modelLabel: 'Model',
    showWhy: 'Why?',
    hideWhy: 'Hide',
    showOriginal: 'Show English original',
    hideOriginal: 'Hide English original',
    originalLabel: 'Original',
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
    combinedTrack: (pct, n) => `this combined method\u2019s past accuracy ${pct}% (n=${n})`,
    combinedTrackPending: 'this combined method is still collecting a track record',
  },
  verdict: {
    title: 'Final verdict',
    heroHits: (hits, graded) => `This round ${hits}/${graded} hit`,
    distributionUp: 'Up',
    distributionDown: 'Down',
    distributionNoDirection: 'No direction',
    sectionCamp: 'Camp',
    sectionTier: 'Tier',
    sectionBook: 'Reasoning vs research',
    sectionCountry: 'By country',
    sectionCountryCaution: 'Per-country samples are small (1–5 models) — read as texture, not a ranking.',
    sectionOverconfident: 'Wrong calls by confidence',
    sectionStreaks: 'Win streaks',
    campLabels: { us: 'US', china: 'China', other: 'Other' },
    tierLabels: { premier: 'PREMIER', challenger: 'CHALLENGER', world: 'WORLD', scout: 'SCOUT' },
    bookLabels: { closed: 'Closed-book', scout: 'Open-book (Scout)' },
    countryLabels: {
      US: 'United States',
      CN: 'China',
      KR: 'South Korea',
      FR: 'France',
      CA: 'Canada',
      INT: 'International',
    },
    rawCount: (hits, graded) => `${hits}/${graded}`,
    ungradedNote: (ungraded) => `+${ungraded} unscored`,
    overconfidentConfidence: (confidence) => `${Math.round(confidence)}`,
    streakLine: (label, streak) => `${label} · ${streak}`,
    expandSection: 'Show',
    collapseSection: 'Hide',
  },
  gating: {
    unavailable: 'This prediction category isn\u2019t available in your region yet.',
    tosNote: 'Availability is based on your account\u2019s declared country and detected location. You must use your real jurisdiction \u2014 attempting to bypass this (e.g. via VPN) shifts responsibility for any resulting misuse to you.',
  },
  languageToggleLabel: 'Language',
  leaderboard: {
    title: 'Leaderboard',
    subtitle: 'Win rates computed only from resolved predictions — not investment advice.',
    tabs: { camp3: 'Camp (3-way)', tier: 'Tier', brand: 'Brand', category: 'Category', korea: 'Korea' },
    moreComparisons: 'More comparisons',
    hideComparisons: 'Hide comparisons',
    campHeadline: 'US vs. China',
    methodHeadline: 'Pure reasoning vs research',
    methodLabels: { pure_reasoning: 'Pure reasoning', research: 'Research (Scout)' },
    campLabels: { us: 'US', china: 'China', other: 'Third country' },
    columns: { rank: '#', name: 'Name', winRate: 'Win rate', record: 'Record' },
    roundCoverage: (graded, unresolvable) =>
      unresolvable > 0
        ? `Computed from ${graded} graded rounds. ${unresolvable} round(s) could not be graded and count for nobody.`
        : `Computed from ${graded} graded rounds.`,
    emptyState: 'Not enough resolved predictions yet — check back as more rounds resolve.',
    asOf: (date) => `As of ${date}`,
    baselinesTitle: 'Reference baselines',
    baselinesNote:
      'Not league participants and not ranked. They exist so a model win rate can be read against a strategy that requires no skill.',
    baselineBadge: 'Baseline',
    alwaysUp: 'Always up',
    alwaysUpHint: 'Predicts up on every round',
    coinFlip: 'Coin flip',
    coinFlipHint: 'Expected 50% line — a reference, not a simulated run',
    coinFlipRecord: 'Reference',
    beatingAlwaysUp: (beating, compared) =>
      `${beating} of ${compared} models are beating Always up`,
    beatingAlwaysUpEmpty: 'No graded rounds yet — Always up has nothing to compare against.',
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
    freeNote: 'Recent results are free. Full history, model filters, date range and CSV export use credits.',
    deepCta: (credits) => `Open deep archive \u00b7 ${credits} credits`,
    deepUnlocking: 'Opening archive\u2026',
    exportCsv: 'Export CSV',
    filterModel: 'Model id',
    filterFrom: 'From',
    filterTo: 'To',
    applyFilters: 'Apply',
    headlineRecent: (correct, graded) =>
      graded > 0 ? `Lately: ${correct} of ${graded} AI calls were right` : 'No graded calls in the recent window yet',
    latestRound: (instrument, outcome) => `Latest: ${instrument} resolved ${outcome}`,
    insufficientCredits: (required, balance) => `Deep archive needs ${required} credits \u2014 you have ${balance}.`,
  },
  hub: {
    title: 'AI Prediction League',
    subtitle: 'What the world\u2019s AI models predict \u2014 and how often they turned out to be right.',
    tabs: { cards: 'Cards', leaderboard: 'Leaderboard', recordRoom: 'Record room' },
    loading: 'Loading\u2026',
    noInstruments: 'The league isn\u2019t available in your region yet.',
    generateLive: (credits) => `Ask the models now \u00b7 ${credits} credits`,
    generating: 'Asking the models\u2026',
    freeReadNote: 'Browsing cards, the leaderboard and recent archive results is free. A live run or a deep archive query spends credits.',
    insufficientCredits: (required, balance) => `A live run needs ${required} credits \u2014 you have ${balance}.`,
    rateLimited: 'Too many requests. Please wait a moment and try again.',
    genericError: 'Something went wrong. Please try again.',
    balance: (credits) => `${credits} credits`,
    deepOpen: (credits) => `Open analysis \u00b7 ${credits} credits`,
    deepDebate: (credits) => `Pro/con debate \u00b7 ${credits} credits`,
    deepRunning: 'Running deep analysis\u2026',
    deepUnscoredNote:
      'Unscored commentary \u2014 not a league prediction. Does not enter the leaderboard or track record.',
    deepOpenTitle: 'Open analysis',
    deepDebateTitle: 'Pro/con debate',
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
    correlatedNote:
      '프리미어·챌린저·월드 모델은 같은 리서치 패킷을 받습니다. 이 숫자는 서로 독립된 40개 예측이 아니라, 입력이 상관된 한 번의 사건입니다.',
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
    realEstate: '통계적 참고용이며 감정평가가 아닙니다. 개별 부동산 가치 산정이 아닙니다.',
  },
  catalog: {
    categories: {
      sports: '스포츠',
      crypto: '암호화폐',
      stocks: '주식',
      fx: '외환',
      gold_metals: '금·귀금속',
      index_etf: '지수·ETF',
      commodities_energy: '원자재·에너지',
      politics_election: '정치·선거',
      entertainment: '엔터테인먼트',
      memecoin: '밈코인',
      real_estate: '부동산',
      macro_econ: '거시경제',
    },
    instruments: {
      AAPL: '애플 (AAPL)',
      NVDA: '엔비디아 (NVDA)',
      TSLA: '테슬라 (TSLA)',
      'BTC/USD': '비트코인 (BTC)',
      'ETH/USD': '이더리움 (ETH)',
      'SOL/USD': '솔라나 (SOL)',
      'EUR/USD': '유로/달러',
      'USD/KRW': '달러/원',
      'USD/JPY': '엔/달러',
      'XAU/USD': '금',
      'XAG/USD': '은',
      SPX: 'S&P 500',
      NDX: '나스닥 100',
      'WTICO/USD': '원유 (WTI)',
      'NATGAS/USD': '천연가스',
      VNQ: '뱅가드 리츠 (VNQ)',
      SCHH: '슈왑 미국 리츠 (SCHH)',
      'DOGE/USD': '도지코인 (DOGE)',
      'SHIB/USD': '시바이누 (SHIB)',
    },
    comingSoon: '준비 중',
    comingSoonHint: '앞으로 이벤트 선택과 질문 검색이 여기에 들어갑니다. 이 카테고리에는 고정 종목이 없습니다.',
    macroEconHint: '금리·물가·채권 등 전문가용 시장 전망. 자극이 아니라 깊이입니다.',
    noCardYet: '이 종목의 예측 카드가 아직 없습니다.',
  },
  hitRate: {
    pending: '적중률 집계 중',
    withValue: (value) => `적중률 ${value}`,
    roundResult: (correct, graded) => `이번 라운드 ${correct}/${graded} 적중`,
  },
  winRate: {
    withSample: (pctText, n) => `${pctText}% (표본 ${n})`,
    record: (wins, losses) => `${wins}승 ${losses}패`,
    insufficient: (wins, losses) => `${wins}승 ${losses}패 (표본 부족)`,
    insufficientNote: '표본 부족',
    rankingBegins: (minSample) =>
      `순위는 채점된 라운드가 ${minSample}건 쌓인 뒤부터 매깁니다. 그전까지는 순위 없이, 퍼센트 대신 승패 기록만 표시합니다.`,
    noRounds: '채점된 라운드 없음',
  },
  grading: {
    inProgress: '채점 중…',
    pending: '채점 대기',
    unresolvable: '채점 불가',
    unresolvableNote:
      '마감 시각은 지났지만 이 라운드는 공정하게 채점할 수 없습니다 — 따라서 어떤 모델도 점수를 받지 않으며, 누구의 전적에도 반영되지 않습니다.',
    stalled: '채점이 끝나지 않음',
    stalledNote: '채점을 시작했지만 결과가 오지 않았습니다. 나중에 새로고침하거나, 기준가가 없다면 먼저 기록하세요.',
    reason: {
      missing_anchor: '이 라운드의 시작 가격이 기록되지 않아 채점할 수 없습니다.',
      invalid_window: '시작·종료 시각이 채점 가능한 구간을 만들지 않습니다.',
      series_unavailable: '과거 시세를 가져오지 못해 아무도 채점되지 않았습니다.',
      no_series_data: '이 구간에 쓸 수 있는 종가가 없습니다.',
      no_session_in_window: '이 예측 구간 안에 마감된 거래일이 없습니다 (주말·휴일).',
      equal_close: '종가가 시작 가격과 같아 누구도 맞거나 틀린 것이 아닙니다.',
      not_price_instrument: '이 종목은 시장 가격이 아니라 이 방식으로 채점할 수 없습니다.',
      unknown: '이 라운드는 채점할 수 없어 누구의 전적에도 들어가지 않습니다.',
    },
  },
  header: {
    atPrediction: '예측 시점',
    now: '현재',
    live: '실시간',
    headlineWithAnchor: (today, instrument, price, anchorDate) =>
      `${today} · ${instrument} · ${price}${anchorDate ? ` (${anchorDate})` : ''}`,
    headlineNoAnchor: (today, instrument) => `${today} · ${instrument} · 기준가 없음`,
    windowWithAnchor: (fromDate, fromPrice, toDate) =>
      `${fromDate} 종가 ${fromPrice}를 기준으로, ${toDate} 종가와 비교해 채점합니다.`,
    windowResolved: (fromDate, fromPrice, toDate, toPrice) =>
      `${fromDate} 종가 ${fromPrice}를 기준으로, ${toDate} 종가 ${toPrice}와 비교해 채점했습니다.`,
    windowAnchorOnly: (fromDate, fromPrice) =>
      `${fromDate} 종가 ${fromPrice}를 기준으로 합니다. 채점에 쓴 거래일은 아직 기록되지 않았습니다.`,
    windowNoSessionDates: '시작 가격은 있지만 거래일 기록이 없어, 시각에서 날짜를 짐작하지 않습니다.',
    windowNoAnchor:
      '이 예측의 시작 가격이 기록되지 않아 실시간 시세는 표시하지 않습니다. 그 숫자를 기준으로 읽으면 잘못된 해석이 됩니다.',
    liveSecondary: '현재',
  },
  modelList: {
    title: (n) => `모델 (${n}개)`,
    tierTab: '티어',
    campTab: '진영',
    empty: '아직 응답한 모델이 없습니다.',
    correct: '적중',
    missed: '실패',
    ungraded: '미채점',
  },
  modelTile: {
    modelLabel: '모델',
    showWhy: '이유 보기',
    hideWhy: '접기',
    showOriginal: '영어 원문 보기',
    hideOriginal: '영어 원문 숨기기',
    originalLabel: '원문',
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
    combinedTrack: (pct, n) => `이 결합 방식의 과거 적중률 ${pct}% (n=${n})`,
    combinedTrackPending: '이 결합 방식은 아직 성적표를 쌓는 중입니다',
  },
  verdict: {
    title: '최종 판정',
    heroHits: (hits, graded) => `이번 라운드 ${hits}/${graded} 적중`,
    distributionUp: '상승',
    distributionDown: '하락',
    distributionNoDirection: '방향 없음',
    sectionCamp: '진영',
    sectionTier: '티어',
    sectionBook: '추론 vs 리서치',
    sectionCountry: '국가별',
    sectionCountryCaution: '국가별 표본은 1–5개 모델로 작습니다. 순위로 읽지 마세요.',
    sectionOverconfident: '허풍 랭킹',
    sectionStreaks: '연승',
    campLabels: { us: 'US', china: 'CN', other: '기타' },
    tierLabels: { premier: 'PREMIER', challenger: 'CHALLENGER', world: 'WORLD', scout: 'SCOUT' },
    bookLabels: { closed: '클로즈드북', scout: '오픈북 (Scout)' },
    countryLabels: {
      US: '미국',
      CN: '중국',
      KR: '한국',
      FR: '프랑스',
      CA: '캐나다',
      INT: '국제',
    },
    rawCount: (hits, graded) => `${hits}/${graded}`,
    ungradedNote: (ungraded) => `+${ungraded} 미채점`,
    overconfidentConfidence: (confidence) => `${Math.round(confidence)}`,
    streakLine: (label, streak) => `${label} · ${streak}연승`,
    expandSection: '펼치기',
    collapseSection: '접기',
  },
  gating: {
    unavailable: '이 예측 카테고리는 아직 회원님의 지역에서 제공되지 않습니다.',
    tosNote: '노출 여부는 계정에 등록된 국가와 감지된 접속 위치를 기준으로 결정됩니다. 반드시 실제 관할 지역을 사용해야 하며, VPN 등으로 이를 우회하려는 시도로 발생하는 문제의 책임은 이용자 본인에게 있습니다.',
  },
  languageToggleLabel: '언어',
  leaderboard: {
    title: '리더보드',
    subtitle: '이미 결과가 확정된 예측만으로 계산한 적중률입니다 — 투자 조언이 아닙니다.',
    tabs: { camp3: '진영 (3자)', tier: '티어', brand: '브랜드', category: '카테고리', korea: '한국' },
    moreComparisons: '비교 더 보기',
    hideComparisons: '비교 접기',
    campHeadline: '미국 vs 중국',
    methodHeadline: '순수 추론 vs 리서치',
    methodLabels: { pure_reasoning: '순수 추론', research: '리서치 (스카우트)' },
    campLabels: { us: '미국', china: '중국', other: '제3국' },
    columns: { rank: '순위', name: '이름', winRate: '적중률', record: '전적' },
    roundCoverage: (graded, unresolvable) =>
      unresolvable > 0
        ? `채점 완료된 ${graded}개 라운드로 계산했습니다. ${unresolvable}개 라운드는 채점할 수 없어 누구의 전적에도 반영되지 않았습니다.`
        : `채점 완료된 ${graded}개 라운드로 계산했습니다.`,
    emptyState: '아직 결과가 확정된 예측이 충분하지 않습니다 — 라운드가 더 확정되면 다시 확인해 주세요.',
    asOf: (date) => `${date} 기준`,
    baselinesTitle: '기준선',
    baselinesNote:
      '리그 참가자가 아니며 순위도 매기지 않습니다. 기술이 필요 없는 전략과 모델 적중률을 나란히 보기 위한 참조입니다.',
    baselineBadge: '기준선',
    alwaysUp: '항상 상승',
    alwaysUpHint: '매 라운드 상승을 예측',
    coinFlip: '동전 던지기',
    coinFlipHint: '기대값 50% 선 — 시뮬레이션이 아닌 참조 표시',
    coinFlipRecord: '참조',
    beatingAlwaysUp: (beating, compared) =>
      `${compared}개 모델 중 ${beating}개가 ‘항상 상승’을 앞서고 있습니다`,
    beatingAlwaysUpEmpty: '채점된 라운드가 없어 ‘항상 상승’과 비교할 수 없습니다.',
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
    freeNote: '최근 결과는 무료입니다. 전체 기록, 모델 필터, 기간 조회, CSV 내보내기는 크레딧이 필요합니다.',
    deepCta: (credits) => `깊은 아카이브 열기 · ${credits} 크레딧`,
    deepUnlocking: '아카이브 여는 중…',
    exportCsv: 'CSV 내보내기',
    filterModel: '모델 ID',
    filterFrom: '시작',
    filterTo: '끝',
    applyFilters: '적용',
    headlineRecent: (correct, graded) =>
      graded > 0 ? `최근: AI 호출 ${graded}건 중 ${correct}건 적중` : '최근 구간에 채점된 호출이 아직 없습니다',
    latestRound: (instrument, outcome) => `최근: ${instrument} → ${outcome}`,
    insufficientCredits: (required, balance) => `깊은 아카이브는 ${required} 크레딧이 필요합니다 — 보유 ${balance}.`,
  },
  hub: {
    title: 'AI 예측 리그',
    subtitle: '전 세계 AI 모델들이 무엇을 예측했고, 실제로 얼마나 맞혔는지 확인하세요.',
    tabs: { cards: '카드', leaderboard: '리더보드', recordRoom: '기록실' },
    loading: '불러오는 중…',
    noInstruments: '아직 회원님의 지역에서는 리그를 이용할 수 없습니다.',
    generateLive: (credits) => `지금 모델에게 물어보기 · ${credits} 크레딧`,
    generating: '모델에게 묻는 중…',
    freeReadNote: '카드·리더보드·최근 기록 열람은 무료입니다. 실시간 실행이나 깊은 아카이브 조회에만 크레딧이 사용됩니다.',
    insufficientCredits: (required, balance) => `실시간 실행에는 ${required} 크레딧이 필요합니다 — 현재 보유 ${balance} 크레딧.`,
    rateLimited: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
    genericError: '문제가 발생했습니다. 다시 시도해 주세요.',
    balance: (credits) => `${credits} 크레딧`,
    deepOpen: (credits) => `개방형 분석 \u00b7 ${credits} 크레딧`,
    deepDebate: (credits) => `찬반 토론 \u00b7 ${credits} 크레딧`,
    deepRunning: '심층 분석 진행 중\u2026',
    deepUnscoredNote: '비채점 논평입니다. 리그 예측이 아니며 리더보드와 전적에 반영되지 않습니다.',
    deepOpenTitle: '개방형 분석',
    deepDebateTitle: '찬반 토론',
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
    correlatedNote:
      'プレミア・チャレンジャー・ワールドは同じリサーチパケットを読むため、これは40件の独立した予測ではなく、入力が相関した一つの出来事です。',
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
    realEstate: '統計的な参考情報であり、鑑定評価ではありません。個別不動産の価格算定ではありません。',
  },
  catalog: {
    categories: {
      sports: 'スポーツ',
      crypto: '暗号資産',
      stocks: '株式',
      fx: '為替',
      gold_metals: '金・貴金属',
      index_etf: '指数・ETF',
      commodities_energy: '商品・エネルギー',
      politics_election: '政治・選挙',
      entertainment: 'エンタメ',
      memecoin: 'ミームコイン',
      real_estate: '不動産',
      macro_econ: 'マクロ経済',
    },
    instruments: {
      AAPL: 'アップル (AAPL)',
      NVDA: 'エヌビディア (NVDA)',
      TSLA: 'テスラ (TSLA)',
      'BTC/USD': 'ビットコイン (BTC)',
      'ETH/USD': 'イーサリアム (ETH)',
      'SOL/USD': 'ソラナ (SOL)',
      'EUR/USD': 'ユーロ / ドル',
      'USD/KRW': 'ドル / ウォン',
      'USD/JPY': 'ドル / 円',
      'XAU/USD': '金',
      'XAG/USD': '銀',
      SPX: 'S&P 500',
      NDX: 'ナスダック100',
      'WTICO/USD': 'WTI原油',
      'NATGAS/USD': '天然ガス',
      VNQ: 'バンガード REIT (VNQ)',
      SCHH: 'シュワブ米国REIT (SCHH)',
      'DOGE/USD': 'ドージコイン (DOGE)',
      'SHIB/USD': '柴犬コイン (SHIB)',
    },
    comingSoon: '近日公開',
    comingSoonHint: 'イベント選択とプロンプト検索はここに入ります。このカテゴリに固定銘柄はありません。',
    macroEconHint: '金利・物価・債券など、専門家向けの市場見通し。刺激ではなく深さです。',
    noCardYet: 'この銘柄の予測カードはまだありません。',
  },
  hitRate: {
    pending: '的中率：集計待ち',
    withValue: (value) => `的中率 ${value}`,
    roundResult: (correct, graded) => `このラウンド ${correct}/${graded} 的中`,
  },
  winRate: {
    withSample: (pctText, n) => `${pctText}%（n=${n}）`,
    record: (wins, losses) => `${wins}勝${losses}敗`,
    insufficient: (wins, losses) => `${wins}勝${losses}敗（標本不足）`,
    insufficientNote: '標本不足',
    rankingBegins: (minSample) =>
      `順位付けは採点済みラウンドが${minSample}件に達してから始まります。それまでは順位を付けず、パーセンテージではなく勝敗記録のみを表示します。`,
    noRounds: '採点済みラウンドなし',
  },
  grading: {
    inProgress: '採点中…',
    pending: '採点待ち',
    unresolvable: '採点不可',
    unresolvableNote:
      '期限は過ぎましたが、このラウンドは公正に採点できません。したがってどのモデルも採点されず、誰の成績にも入りません。',
    stalled: '採点が完了しませんでした',
    stalledNote: '採点を始めましたが結果が届きません。あとで再読み込みするか、基準値が無い場合は先に記録してください。',
    reason: {
      missing_anchor: 'このラウンドの開始価格が記録されていないため採点できません。',
      invalid_window: '開始と終了の時刻が、採点できる区間になっていません。',
      series_unavailable: '過去の価格系列を取得できず、誰も採点されていません。',
      no_series_data: 'この区間に使える終値がありません。',
      no_session_in_window: 'この予測区間内に終わった取引日がありません（週末・祝日）。',
      equal_close: '終値が開始価格と一致したため、正解も不正解もありません。',
      not_price_instrument: 'この銘柄は市場価格ではないため、この方法では採点できません。',
      unknown: 'このラウンドは採点できないため、誰の成績にも入りません。',
    },
  },
  header: {
    atPrediction: '予測時点',
    now: '現在',
    live: 'ライブ',
    headlineWithAnchor: (today, instrument, price, anchorDate) =>
      `${today} · ${instrument} · ${price}${anchorDate ? ` (${anchorDate})` : ''}`,
    headlineNoAnchor: (today, instrument) => `${today} · ${instrument} · 基準値なし`,
    windowWithAnchor: (fromDate, fromPrice, toDate) =>
      `${fromDate}の終値 ${fromPrice}を起点に、${toDate}の終値と比較して採点します。`,
    windowResolved: (fromDate, fromPrice, toDate, toPrice) =>
      `${fromDate}の終値 ${fromPrice}を起点に、${toDate}の終値 ${toPrice}と比較して採点しました。`,
    windowAnchorOnly: (fromDate, fromPrice) =>
      `${fromDate}の終値 ${fromPrice}を起点にします。採点に使った取引日はまだ記録されていません。`,
    windowNoSessionDates: '開始価格はありますが取引日が無いため、時刻から日付を推測しません。',
    windowNoAnchor:
      'この予測の開始価格が記録されていないため、リアルタイム相場は表示しません。その数字を基準に読むと誤ります。',
    liveSecondary: '現在',
  },
  modelList: {
    title: (n) => `モデル（${n}）`,
    tierTab: 'ティア',
    campTab: '陣営',
    empty: 'まだ回答したモデルがありません。',
    correct: '的中',
    missed: '外れ',
    ungraded: '未採点',
  },
  modelTile: {
    modelLabel: 'モデル',
    showWhy: '理由',
    hideWhy: '閉じる',
    showOriginal: '英語の原文を表示',
    hideOriginal: '英語の原文を隠す',
    originalLabel: '原文',
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
    combinedTrack: (pct, n) => `この合成方式の過去的中率 ${pct}%（n=${n}）`,
    combinedTrackPending: 'この合成方式はまだ成績を蓄積しています',
  },
  verdict: {
    title: '最終判定',
    heroHits: (hits, graded) => `今回のラウンド ${hits}/${graded} 的中`,
    distributionUp: '上昇',
    distributionDown: '下落',
    distributionNoDirection: '方向なし',
    sectionCamp: '陣営',
    sectionTier: 'ティア',
    sectionBook: '推論 vs リサーチ',
    sectionCountry: '国別',
    sectionCountryCaution: '国別の標本は1–5モデルと小さいです。順位として読まないでください。',
    sectionOverconfident: '自信過剰ランキング',
    sectionStreaks: '連勝',
    campLabels: { us: 'US', china: 'CN', other: 'その他' },
    tierLabels: { premier: 'PREMIER', challenger: 'CHALLENGER', world: 'WORLD', scout: 'SCOUT' },
    bookLabels: { closed: 'クローズドブック', scout: 'オープンブック（Scout）' },
    countryLabels: {
      US: 'アメリカ',
      CN: '中国',
      KR: '韓国',
      FR: 'フランス',
      CA: 'カナダ',
      INT: '国際',
    },
    rawCount: (hits, graded) => `${hits}/${graded}`,
    ungradedNote: (ungraded) => `+${ungraded} 未採点`,
    overconfidentConfidence: (confidence) => `${Math.round(confidence)}`,
    streakLine: (label, streak) => `${label} · ${streak}連勝`,
    expandSection: '開く',
    collapseSection: '閉じる',
  },
  gating: {
    unavailable: 'この予測カテゴリーは、お住まいの地域ではまだご利用いただけません。',
    tosNote: '表示可否はアカウントに登録された国と検出された接続地域に基づいて判定されます。実際の管轄地域を使用してください。VPN等でこれを回避しようとした場合に生じる問題の責任はご自身が負うものとします。',
  },
  languageToggleLabel: '言語',
  leaderboard: {
    title: 'リーダーボード',
    subtitle: '確定済みの予測のみから算出した的中率です — 投資助言ではありません。',
    tabs: { camp3: '陣営（3者）', tier: 'ティア', brand: 'ブランド', category: 'カテゴリー', korea: '韓国' },
    moreComparisons: '比較をさらに表示',
    hideComparisons: '比較を隠す',
    campHeadline: '米国 vs 中国',
    methodHeadline: '純粋推論 vs リサーチ',
    methodLabels: { pure_reasoning: '純粋推論', research: 'リサーチ（スカウト）' },
    campLabels: { us: '米国', china: '中国', other: '第三国' },
    columns: { rank: '順位', name: '名前', winRate: '的中率', record: '勝敗' },
    roundCoverage: (graded, unresolvable) =>
      unresolvable > 0
        ? `採点済み${graded}ラウンドから算出しています。${unresolvable}ラウンドは採点できず、誰の成績にも入っていません。`
        : `採点済み${graded}ラウンドから算出しています。`,
    emptyState: 'まだ確定した予測が十分にありません — ラウンドが確定するたびに更新されます。',
    asOf: (date) => `${date}時点`,
    baselinesTitle: '参照ベースライン',
    baselinesNote:
      'リーグ参加者ではなく、順位も付きません。スキルを要しない戦略とモデル的中率を並べて読むための参照です。',
    baselineBadge: 'ベースライン',
    alwaysUp: '常に上昇',
    alwaysUpHint: '毎ラウンド上昇を予測',
    coinFlip: 'コイントス',
    coinFlipHint: '期待値50%の線 — シミュレーションではなく参照表示',
    coinFlipRecord: '参照',
    beatingAlwaysUp: (beating, compared) =>
      `${compared}モデル中${beating}が「常に上昇」を上回っています`,
    beatingAlwaysUpEmpty: '採点済みラウンドがないため、「常に上昇」と比較できません。',
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
    freeNote: '直近の結果は無料です。全履歴・モデル絞り込み・期間指定・CSV書き出しはクレジットが必要です。',
    deepCta: (credits) => `詳細アーカイブを開く・${credits}クレジット`,
    deepUnlocking: 'アーカイブを開いています…',
    exportCsv: 'CSVを書き出す',
    filterModel: 'モデルID',
    filterFrom: '開始',
    filterTo: '終了',
    applyFilters: '適用',
    headlineRecent: (correct, graded) =>
      graded > 0 ? `直近: AIの判断${graded}件中${correct}件が的中` : '直近の期間に採点済みの判断はまだありません',
    latestRound: (instrument, outcome) => `最新: ${instrument} → ${outcome}`,
    insufficientCredits: (required, balance) => `詳細アーカイブには${required}クレジットが必要です — 残高 ${balance}。`,
  },
  hub: {
    title: 'AI予測リーグ',
    subtitle: '世界のAIモデルが何を予測し、実際にどれだけ的中したかを見られます。',
    tabs: { cards: 'カード', leaderboard: 'リーダーボード', recordRoom: '記録室' },
    loading: '読み込み中…',
    noInstruments: 'お住まいの地域では、リーグはまだご利用いただけません。',
    generateLive: (credits) => `今すぐモデルに聞く・${credits}クレジット`,
    generating: 'モデルに問い合わせ中…',
    freeReadNote: 'カード・リーダーボード・直近の記録室は無料です。ライブ実行と詳細アーカイブだけがクレジットを消費します。',
    insufficientCredits: (required, balance) => `ライブ実行には${required}クレジットが必要です — 現在の残高は${balance}クレジットです。`,
    rateLimited: 'リクエストが多すぎます。少し時間をおいて再度お試しください。',
    genericError: 'エラーが発生しました。もう一度お試しください。',
    balance: (credits) => `${credits}クレジット`,
    deepOpen: (credits) => `自由分析 \u00b7 ${credits}クレジット`,
    deepDebate: (credits) => `賛否討論 \u00b7 ${credits}クレジット`,
    deepRunning: '深層分析を実行中\u2026',
    deepUnscoredNote: '採点対象外の論評です。リーグ予測ではなく、リーダーボードや戦績には入りません。',
    deepOpenTitle: '自由分析',
    deepDebateTitle: '賛否討論',
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
    correlatedNote:
      'Premier、Challenger、World 都讀同一份研究資料包，因此這是輸入相關的單一事件，不是 40 個獨立預測。',
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
    realEstate: '僅供統計參考，並非正式估價。僅涵蓋區域／標的層級，不對個別不動產估價。',
  },
  catalog: {
    categories: {
      sports: '運動',
      crypto: '加密貨幣',
      stocks: '股票',
      fx: '外匯',
      gold_metals: '黃金與金屬',
      index_etf: '指數／ETF',
      commodities_energy: '大宗商品與能源',
      politics_election: '政治與選舉',
      entertainment: '娛樂',
      memecoin: '迷因幣',
      real_estate: '不動產',
      macro_econ: '總體經濟',
    },
    instruments: {
      AAPL: '蘋果 (AAPL)',
      NVDA: '輝達 (NVDA)',
      TSLA: '特斯拉 (TSLA)',
      'BTC/USD': '比特幣 (BTC)',
      'ETH/USD': '以太坊 (ETH)',
      'SOL/USD': '索拉納 (SOL)',
      'EUR/USD': '歐元／美元',
      'USD/KRW': '美元／韓元',
      'USD/JPY': '美元／日圓',
      'XAU/USD': '黃金',
      'XAG/USD': '白銀',
      SPX: 'S&P 500',
      NDX: '那斯達克100',
      'WTICO/USD': 'WTI 原油',
      'NATGAS/USD': '天然氣',
      VNQ: '先鋒不動產 (VNQ)',
      SCHH: '嘉信美國 REIT (SCHH)',
      'DOGE/USD': '狗狗幣 (DOGE)',
      'SHIB/USD': '柴犬幣 (SHIB)',
    },
    comingSoon: '即將推出',
    comingSoonHint: '活動選擇與提問搜尋將放在這裡。此類別沒有固定標的。',
    macroEconHint: '利率、通膨、債券等專業市場展望。重深度，不重刺激。',
    noCardYet: '此標的尚無預測卡。',
  },
  hitRate: {
    pending: '命中率：統計中',
    withValue: (value) => `命中率 ${value}`,
    roundResult: (correct, graded) => `本輪 ${correct}/${graded} 命中`,
  },
  winRate: {
    withSample: (pctText, n) => `${pctText}%（n=${n}）`,
    record: (wins, losses) => `${wins}勝 ${losses}敗`,
    insufficient: (wins, losses) => `${wins}勝 ${losses}敗（樣本不足）`,
    insufficientNote: '樣本不足',
    rankingBegins: (minSample) =>
      `累積 ${minSample} 個已評分輪次後才開始排名。在此之前不排名，並以勝敗紀錄取代百分比。`,
    noRounds: '尚無已評分輪次',
  },
  grading: {
    inProgress: '評分中…',
    pending: '待評分',
    unresolvable: '無法評分',
    unresolvableNote: '截止時間已過，但本輪無法公正評分，因此沒有任何模型被計分，也不計入任何紀錄。',
    stalled: '評分未完成',
    stalledNote: '已開始評分但未取得結果。請稍後重新整理；若本輪沒有基準價，請先補上。',
    reason: {
      missing_anchor: '本輪沒有記錄起始價格，因此無法評分。',
      invalid_window: '起迄時間無法構成可評分的區間。',
      series_unavailable: '無法取得歷史行情，因此無人被評分。',
      no_series_data: '此區間沒有可用的收盤價。',
      no_session_in_window: '此預測區間內沒有收盤的交易日（週末或假日）。',
      equal_close: '收盤價與起始價格完全相同，因此無人對或錯。',
      not_price_instrument: '此標的不是市場價格，無法用此方式評分。',
      unknown: '本輪無法評分，因此不計入任何人的戰績。',
    },
  },
  header: {
    atPrediction: '預測時',
    now: '目前',
    live: '即時',
    headlineWithAnchor: (today, instrument, price, anchorDate) =>
      `${today} · ${instrument} · ${price}${anchorDate ? ` (${anchorDate})` : ''}`,
    headlineNoAnchor: (today, instrument) => `${today} · ${instrument} · 無基準價`,
    windowWithAnchor: (fromDate, fromPrice, toDate) =>
      `以 ${fromDate} 收盤價 ${fromPrice} 為基準，對照 ${toDate} 收盤價評分。`,
    windowResolved: (fromDate, fromPrice, toDate, toPrice) =>
      `以 ${fromDate} 收盤價 ${fromPrice} 為基準，對照 ${toDate} 收盤價 ${toPrice} 完成評分。`,
    windowAnchorOnly: (fromDate, fromPrice) =>
      `以 ${fromDate} 收盤價 ${fromPrice} 為基準。評分所用交易日尚未記錄。`,
    windowNoSessionDates: '已有起始價格，但沒有交易日紀錄，因此不從時間戳推測日期。',
    windowNoAnchor: '本預測未記錄起始價格，因此不顯示即時報價——用那個數字解讀預測會誤導。',
    liveSecondary: '目前',
  },
  modelList: {
    title: (n) => `模型（${n}）`,
    tierTab: '級別',
    campTab: '陣營',
    empty: '目前尚無模型回應。',
    correct: '命中',
    missed: '未命中',
    ungraded: '未評分',
  },
  modelTile: {
    modelLabel: '模型',
    showWhy: '理由',
    hideWhy: '收合',
    showOriginal: '顯示英文原文',
    hideOriginal: '隱藏英文原文',
    originalLabel: '原文',
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
    combinedTrack: (pct, n) => `此綜合方式的過往命中率 ${pct}%（n=${n}）`,
    combinedTrackPending: '此綜合方式仍在累積紀錄',
  },
  verdict: {
    title: '最終判定',
    heroHits: (hits, graded) => `本輪 ${hits}/${graded} 命中`,
    distributionUp: '上漲',
    distributionDown: '下跌',
    distributionNoDirection: '無方向',
    sectionCamp: '陣營',
    sectionTier: '級別',
    sectionBook: '推理 vs 研究',
    sectionCountry: '依國家',
    sectionCountryCaution: '各國樣本僅 1–5 個模型，請勿當成排名。',
    sectionOverconfident: '虛張聲勢排名',
    sectionStreaks: '連勝',
    campLabels: { us: 'US', china: 'CN', other: '其他' },
    tierLabels: { premier: 'PREMIER', challenger: 'CHALLENGER', world: 'WORLD', scout: 'SCOUT' },
    bookLabels: { closed: '封閉書', scout: '開放書（Scout）' },
    countryLabels: {
      US: '美國',
      CN: '中國',
      KR: '韓國',
      FR: '法國',
      CA: '加拿大',
      INT: '國際',
    },
    rawCount: (hits, graded) => `${hits}/${graded}`,
    ungradedNote: (ungraded) => `+${ungraded} 未評分`,
    overconfidentConfidence: (confidence) => `${Math.round(confidence)}`,
    streakLine: (label, streak) => `${label} · ${streak} 連勝`,
    expandSection: '展開',
    collapseSection: '收合',
  },
  gating: {
    unavailable: '此預測類別在您所在地區尚未開放。',
    tosNote: '是否顯示取決於您帳號登記的國家與偵測到的所在位置。您必須使用真實所在地區；若透過 VPN 等方式規避此限制，由此產生的任何後果由您自行承擔。',
  },
  languageToggleLabel: '語言',
  leaderboard: {
    title: '排行榜',
    subtitle: '命中率僅根據已結算的預測計算 — 並非投資建議。',
    tabs: { camp3: '陣營（三方）', tier: '級別', brand: '品牌', category: '類別', korea: '韓國' },
    moreComparisons: '更多比較',
    hideComparisons: '收合比較',
    campHeadline: '美國 vs 中國',
    methodHeadline: '純推理 vs 研究',
    methodLabels: { pure_reasoning: '純推理', research: '研究（Scout）' },
    campLabels: { us: '美國', china: '中國', other: '第三國' },
    columns: { rank: '排名', name: '名稱', winRate: '命中率', record: '勝敗' },
    roundCoverage: (graded, unresolvable) =>
      unresolvable > 0
        ? `依據 ${graded} 個已評分輪次計算。有 ${unresolvable} 個輪次無法評分，不計入任何紀錄。`
        : `依據 ${graded} 個已評分輪次計算。`,
    emptyState: '目前已結算的預測還不夠多 — 之後會有更多輪次結算，請稍後再查看。',
    asOf: (date) => `更新於 ${date}`,
    baselinesTitle: '參考基準',
    baselinesNote:
      '不是聯賽參賽者，也不排名。用來把模型命中率對照一個不需技巧的策略。',
    baselineBadge: '基準',
    alwaysUp: '一律看漲',
    alwaysUpHint: '每一輪都預測上漲',
    coinFlip: '擲硬幣',
    coinFlipHint: '期望 50% 線 — 參考標記，不是模擬結果',
    coinFlipRecord: '參考',
    beatingAlwaysUp: (beating, compared) =>
      `${compared} 個模型中有 ${beating} 個勝過「一律看漲」`,
    beatingAlwaysUpEmpty: '尚無已評分輪次，無法與「一律看漲」比較。',
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
    freeNote: '近期結果免費。完整歷史、模型篩選、日期範圍與 CSV 匯出需使用點數。',
    deepCta: (credits) => `開啟深度封存・${credits} 點數`,
    deepUnlocking: '正在開啟封存…',
    exportCsv: '匯出 CSV',
    filterModel: '模型 ID',
    filterFrom: '起',
    filterTo: '迄',
    applyFilters: '套用',
    headlineRecent: (correct, graded) =>
      graded > 0 ? `近期：${graded} 次 AI 判斷中命中 ${correct} 次` : '近期尚無已評分的判斷',
    latestRound: (instrument, outcome) => `最新：${instrument} → ${outcome}`,
    insufficientCredits: (required, balance) => `深度封存需要 ${required} 點數 — 您目前有 ${balance} 點。`,
  },
  hub: {
    title: 'AI 預測聯賽',
    subtitle: '看看全球 AI 模型預測了什麼，以及它們實際命中的紀錄。',
    tabs: { cards: '卡片', leaderboard: '排行榜', recordRoom: '紀錄室' },
    loading: '載入中…',
    noInstruments: '您所在的地區尚未開放本聯賽。',
    generateLive: (credits) => `立即詢問模型・${credits} 點數`,
    generating: '正在詢問模型…',
    freeReadNote: '瀏覽卡片、排行榜與近期紀錄免費。即時執行或深度封存查詢才會消耗點數。',
    insufficientCredits: (required, balance) => `即時執行需要 ${required} 點數 — 您目前有 ${balance} 點。`,
    rateLimited: '請求過於頻繁，請稍候再試。',
    genericError: '發生錯誤，請再試一次。',
    balance: (credits) => `${credits} 點數`,
    deepOpen: (credits) => `開放分析 \u00b7 ${credits} 點數`,
    deepDebate: (credits) => `正反辯論 \u00b7 ${credits} 點數`,
    deepRunning: '深度分析進行中\u2026',
    deepUnscoredNote: '未計分評論——不是聯盟預測，不會進入排行榜或戰績。',
    deepOpenTitle: '開放分析',
    deepDebateTitle: '正反辯論',
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
    correlatedNote:
      'Premier, Challenger et World lisent le même dossier de recherche : c\u2019est un seul événement à entrées corrélées, pas 40 prévisions indépendantes.',
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
    realEstate:
      'Référence statistique uniquement — pas une expertise immobilière. Horizon régional ou d\u2019instrument, pas une évaluation d\u2019un bien précis.',
  },
  catalog: {
    categories: {
      sports: 'Sports',
      crypto: 'Crypto',
      stocks: 'Actions',
      fx: 'Forex',
      gold_metals: 'Or et métaux',
      index_etf: 'Indices / ETF',
      commodities_energy: 'Matières premières',
      politics_election: 'Politique',
      entertainment: 'Divertissement',
      memecoin: 'Memecoin',
      real_estate: 'Immobilier',
      macro_econ: 'Macro',
    },
    instruments: {
      AAPL: 'Apple (AAPL)',
      NVDA: 'NVIDIA (NVDA)',
      TSLA: 'Tesla (TSLA)',
      'BTC/USD': 'Bitcoin (BTC)',
      'ETH/USD': 'Ethereum (ETH)',
      'SOL/USD': 'Solana (SOL)',
      'EUR/USD': 'Euro / dollar',
      'USD/KRW': 'Dollar / won',
      'USD/JPY': 'Dollar / yen',
      'XAU/USD': 'Or',
      'XAG/USD': 'Argent',
      SPX: 'S&P 500',
      NDX: 'Nasdaq 100',
      'WTICO/USD': 'Pétrole WTI',
      'NATGAS/USD': 'Gaz naturel',
      VNQ: 'Vanguard Immobilier (VNQ)',
      SCHH: 'Schwab REIT US (SCHH)',
      'DOGE/USD': 'Dogecoin (DOGE)',
      'SHIB/USD': 'Shiba Inu (SHIB)',
    },
    comingSoon: 'Bientôt',
    comingSoonHint: 'Le sélecteur d\u2019événements et la recherche par question seront ici. Pas d\u2019instruments fixes pour cette catégorie.',
    macroEconHint: 'Perspectives de marché pour experts — taux, inflation, obligations. De la profondeur, pas du spectacle.',
    noCardYet: 'Pas encore de carte de prédiction pour cet instrument.',
  },
  hitRate: {
    pending: 'Taux de réussite : en attente',
    withValue: (value) => `${value} de réussite`,
    roundResult: (correct, graded) => `Ce tour : ${correct}/${graded} justes`,
  },
  winRate: {
    withSample: (pctText, n) => `${pctText}% (n=${n})`,
    record: (wins, losses) => `${wins}V ${losses}D`,
    insufficient: (wins, losses) => `${wins}V ${losses}D (échantillon insuffisant)`,
    insufficientNote: 'Échantillon insuffisant',
    rankingBegins: (minSample) =>
      `Le classement commence après ${minSample} tours notés. D\u2019ici là, les résultats sont présentés sans classement, avec le bilan brut au lieu d\u2019un pourcentage.`,
    noRounds: 'Aucun tour noté',
  },
  grading: {
    inProgress: 'Notation en cours\u2026',
    pending: 'En attente de notation',
    unresolvable: 'Non notable',
    unresolvableNote:
      'L\u2019échéance est passée, mais ce tour ne peut pas être noté équitablement : aucun modèle n\u2019a donc été noté et il ne compte pour personne.',
    stalled: 'La notation n\u2019est pas terminée',
    stalledNote:
      'Une notation a été lancée mais aucun résultat n\u2019est arrivé. Actualisez plus tard, ou enregistrez d\u2019abord le cours de départ s\u2019il manque.',
    reason: {
      missing_anchor: 'Aucun cours de départ n\u2019a été enregistré pour ce tour, il ne peut donc pas être noté.',
      invalid_window: 'Les horaires de début et de fin ne forment pas une fenêtre utilisable.',
      series_unavailable: 'La série de cours historiques n\u2019a pas pu être récupérée : personne n\u2019a été noté.',
      no_series_data: 'Le flux n\u2019a renvoyé aucune clôture utilisable pour cette fenêtre.',
      no_session_in_window: 'Aucune séance n\u2019a clôturé dans cette fenêtre (week-end ou jour férié).',
      equal_close: 'La clôture est exactement égale au cours de départ : personne n\u2019a raison ni tort.',
      not_price_instrument: 'Cet instrument n\u2019est pas un cours de marché, il ne peut pas être noté ainsi.',
      unknown: 'Ce tour ne peut pas être noté, il ne compte pour personne.',
    },
  },
  header: {
    atPrediction: 'au moment de la prédiction',
    now: 'actuel',
    live: 'EN DIRECT',
    headlineWithAnchor: (today, instrument, price, anchorDate) =>
      `${today} \u00b7 ${instrument} \u00b7 ${price}${anchorDate ? ` (${anchorDate})` : ''}`,
    headlineNoAnchor: (today, instrument) => `${today} \u00b7 ${instrument} \u00b7 cours de départ indisponible`,
    windowWithAnchor: (fromDate, fromPrice, toDate) =>
      `Mesuré depuis la clôture du ${fromDate} à ${fromPrice}, noté contre la clôture du ${toDate}.`,
    windowResolved: (fromDate, fromPrice, toDate, toPrice) =>
      `Mesuré depuis la clôture du ${fromDate} à ${fromPrice}, résolu contre la clôture du ${toDate} à ${toPrice}.`,
    windowAnchorOnly: (fromDate, fromPrice) =>
      `Mesuré depuis la clôture du ${fromDate} à ${fromPrice}. La séance de résolution n\u2019est pas encore enregistrée.`,
    windowNoSessionDates:
      'Le cours de départ est enregistré, mais pas les dates de séance — elles ne sont pas déduites des horodatages.',
    windowNoAnchor:
      'Le cours de départ de cette prédiction n\u2019a pas été enregistré, le cours en direct n\u2019est donc pas affiché \u2014 ce serait le mauvais chiffre pour lire ces appels.',
    liveSecondary: 'actuel',
  },
  modelList: {
    title: (n) => `Modèles (${n})`,
    tierTab: 'Niveau',
    campTab: 'Camp',
    empty: 'Aucun modèle n\u2019a encore répondu.',
    correct: 'Correct',
    missed: 'Manqué',
    ungraded: 'Non noté',
  },
  modelTile: {
    modelLabel: 'Modèle',
    showWhy: 'Pourquoi ?',
    hideWhy: 'Masquer',
    showOriginal: 'Afficher l\u2019original anglais',
    hideOriginal: 'Masquer l\u2019original anglais',
    originalLabel: 'Original',
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
    combinedTrack: (pct, n) => `précision passée de cette méthode combinée ${pct}% (n=${n})`,
    combinedTrackPending: 'cette méthode combinée constitue encore son historique',
  },
  verdict: {
    title: 'Verdict final',
    heroHits: (hits, graded) => `Ce tour ${hits}/${graded} justes`,
    distributionUp: 'Hausse',
    distributionDown: 'Baisse',
    distributionNoDirection: 'Sans direction',
    sectionCamp: 'Bloc',
    sectionTier: 'Niveau',
    sectionBook: 'Raisonnement vs recherche',
    sectionCountry: 'Par pays',
    sectionCountryCaution: 'Les échantillons par pays sont petits (1–5 modèles) — à lire comme un contexte, pas un classement.',
    sectionOverconfident: 'Appels faux par confiance',
    sectionStreaks: 'Séries de victoires',
    campLabels: { us: 'US', china: 'Chine', other: 'Autre' },
    tierLabels: { premier: 'PREMIER', challenger: 'CHALLENGER', world: 'WORLD', scout: 'SCOUT' },
    bookLabels: { closed: 'Livre fermé', scout: 'Livre ouvert (Scout)' },
    countryLabels: {
      US: 'États-Unis',
      CN: 'Chine',
      KR: 'Corée du Sud',
      FR: 'France',
      CA: 'Canada',
      INT: 'International',
    },
    rawCount: (hits, graded) => `${hits}/${graded}`,
    ungradedNote: (ungraded) => `+${ungraded} non notés`,
    overconfidentConfidence: (confidence) => `${Math.round(confidence)}`,
    streakLine: (label, streak) => `${label} · ${streak} d’affilée`,
    expandSection: 'Afficher',
    collapseSection: 'Masquer',
  },
  gating: {
    unavailable: 'Cette catégorie de prédiction n\u2019est pas encore disponible dans votre région.',
    tosNote: 'La disponibilité dépend du pays déclaré sur votre compte et de votre localisation détectée. Vous devez utiliser votre véritable juridiction \u2014 toute tentative de contournement (par VPN, par exemple) vous rend responsable des conséquences.',
  },
  languageToggleLabel: 'Langue',
  leaderboard: {
    title: 'Classement',
    subtitle: 'Taux de réussite calculés uniquement sur les prédictions résolues — ceci n\u2019est pas un conseil en investissement.',
    tabs: { camp3: 'Camp (3 voies)', tier: 'Niveau', brand: 'Marque', category: 'Catégorie', korea: 'Corée' },
    moreComparisons: 'Plus de comparaisons',
    hideComparisons: 'Masquer les comparaisons',
    campHeadline: '\u00c9tats-Unis vs Chine',
    methodHeadline: 'Raisonnement pur vs recherche',
    methodLabels: { pure_reasoning: 'Raisonnement pur', research: 'Recherche (Scout)' },
    campLabels: { us: 'États-Unis', china: 'Chine', other: 'Pays tiers' },
    columns: { rank: '#', name: 'Nom', winRate: 'Taux de réussite', record: 'Bilan' },
    roundCoverage: (graded, unresolvable) =>
      unresolvable > 0
        ? `Calculé à partir de ${graded} tours notés. ${unresolvable} tour(s) n\u2019ont pas pu être notés et ne comptent pour personne.`
        : `Calculé à partir de ${graded} tours notés.`,
    emptyState: 'Pas encore assez de prédictions résolues — revenez plus tard, au fil des résolutions.',
    asOf: (date) => `Au ${date}`,
    baselinesTitle: 'Références de base',
    baselinesNote:
      'Ce ne sont pas des participants du championnat et ils ne sont pas classés. Ils servent à lire un taux de réussite face à une stratégie sans compétence.',
    baselineBadge: 'Référence',
    alwaysUp: 'Toujours à la hausse',
    alwaysUpHint: 'Prédit une hausse à chaque tour',
    coinFlip: 'Pile ou face',
    coinFlipHint: 'Ligne attendue à 50 % — un repère, pas une simulation',
    coinFlipRecord: 'Repère',
    beatingAlwaysUp: (beating, compared) =>
      `${beating} modèles sur ${compared} battent « Toujours à la hausse »`,
    beatingAlwaysUpEmpty: 'Aucun tour noté — rien à comparer à « Toujours à la hausse ».',
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
    freeNote: 'Les résultats récents sont gratuits. L\u2019historique complet, les filtres, les dates et l\u2019export CSV consomment des crédits.',
    deepCta: (credits) => `Ouvrir les archives détaillées \u00b7 ${credits} crédits`,
    deepUnlocking: 'Ouverture des archives\u2026',
    exportCsv: 'Exporter en CSV',
    filterModel: 'Id du modèle',
    filterFrom: 'Du',
    filterTo: 'Au',
    applyFilters: 'Appliquer',
    headlineRecent: (correct, graded) =>
      graded > 0 ? `Récemment : ${correct} des ${graded} appels IA étaient justes` : 'Aucun appel noté dans la fenêtre récente',
    latestRound: (instrument, outcome) => `Dernier : ${instrument} → ${outcome}`,
    insufficientCredits: (required, balance) => `Les archives détaillées coûtent ${required} crédits \u2014 vous en avez ${balance}.`,
  },
  hub: {
    title: 'Ligue de prédiction IA',
    subtitle: 'Ce que prédisent les modèles d\u2019IA du monde entier \u2014 et à quelle fréquence ils ont eu raison.',
    tabs: { cards: 'Cartes', leaderboard: 'Classement', recordRoom: 'Archives' },
    loading: 'Chargement\u2026',
    noInstruments: 'La ligue n\u2019est pas encore disponible dans votre région.',
    generateLive: (credits) => `Interroger les modèles maintenant \u00b7 ${credits} crédits`,
    generating: 'Interrogation des modèles\u2026',
    freeReadNote: 'Consulter les cartes, le classement et les archives récentes est gratuit. Une exécution en direct ou une requête d\u2019archives détaillées consomme des crédits.',
    insufficientCredits: (required, balance) => `Une exécution en direct coûte ${required} crédits \u2014 vous en avez ${balance}.`,
    rateLimited: 'Trop de requêtes. Patientez un instant avant de réessayer.',
    genericError: 'Une erreur est survenue. Veuillez réessayer.',
    balance: (credits) => `${credits} crédits`,
    deepOpen: (credits) => `Analyse ouverte \u00b7 ${credits} cr\u00e9dits`,
    deepDebate: (credits) => `D\u00e9bat pour/contre \u00b7 ${credits} cr\u00e9dits`,
    deepRunning: 'Analyse approfondie en cours\u2026',
    deepUnscoredNote:
      'Commentaire non not\u00e9 \u2014 ce n\u2019est pas une pr\u00e9diction de ligue. N\u2019entre ni au classement ni au palmar\u00e8s.',
    deepOpenTitle: 'Analyse ouverte',
    deepDebateTitle: 'D\u00e9bat pour/contre',
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
    correlatedNote:
      'Premier, Challenger y World leen el mismo paquete de investigación: esto es un solo evento con entradas correlacionadas, no 40 pronósticos independientes.',
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
    realEstate:
      'Solo referencia estadística, no es una tasación formal. Perspectiva de región o instrumento, no la valoración de un inmueble concreto.',
  },
  catalog: {
    categories: {
      sports: 'Deportes',
      crypto: 'Cripto',
      stocks: 'Acciones',
      fx: 'Divisas',
      gold_metals: 'Oro y metales',
      index_etf: 'Índices / ETF',
      commodities_energy: 'Materias primas',
      politics_election: 'Política',
      entertainment: 'Entretenimiento',
      memecoin: 'Memecoin',
      real_estate: 'Inmuebles',
      macro_econ: 'Macro',
    },
    instruments: {
      AAPL: 'Apple (AAPL)',
      NVDA: 'NVIDIA (NVDA)',
      TSLA: 'Tesla (TSLA)',
      'BTC/USD': 'Bitcoin (BTC)',
      'ETH/USD': 'Ethereum (ETH)',
      'SOL/USD': 'Solana (SOL)',
      'EUR/USD': 'Euro / dólar',
      'USD/KRW': 'Dólar / won',
      'USD/JPY': 'Dólar / yen',
      'XAU/USD': 'Oro',
      'XAG/USD': 'Plata',
      SPX: 'S&P 500',
      NDX: 'Nasdaq 100',
      'WTICO/USD': 'Petróleo WTI',
      'NATGAS/USD': 'Gas natural',
      VNQ: 'Vanguard inmobiliario (VNQ)',
      SCHH: 'Schwab REIT EE.UU. (SCHH)',
      'DOGE/USD': 'Dogecoin (DOGE)',
      'SHIB/USD': 'Shiba Inu (SHIB)',
    },
    comingSoon: 'Próximamente',
    comingSoonHint: 'El selector de eventos y la búsqueda por pregunta estarán aquí. Esta categoría no tiene instrumentos fijos.',
    macroEconHint: 'Perspectiva de mercado para expertos: tipos, inflación, bonos. Profundidad, no dopamina.',
    noCardYet: 'Aún no hay tarjeta de predicción para este instrumento.',
  },
  hitRate: {
    pending: 'Tasa de acierto: pendiente',
    withValue: (value) => `${value} de acierto`,
    roundResult: (correct, graded) => `Esta ronda: ${correct}/${graded} aciertos`,
  },
  winRate: {
    withSample: (pctText, n) => `${pctText}% (n=${n})`,
    record: (wins, losses) => `${wins}G ${losses}P`,
    insufficient: (wins, losses) => `${wins}G ${losses}P (muestra insuficiente)`,
    insufficientNote: 'Muestra insuficiente',
    rankingBegins: (minSample) =>
      `La clasificación empieza tras ${minSample} rondas calificadas. Hasta entonces se muestran sin clasificar, con el registro en bruto en lugar de un porcentaje.`,
    noRounds: 'Sin rondas calificadas',
  },
  grading: {
    inProgress: 'Calificando\u2026',
    pending: 'Pendiente de calificación',
    unresolvable: 'No se puede calificar',
    unresolvableNote:
      'El plazo venció, pero esta ronda no puede calificarse de forma justa: ningún modelo fue puntuado y no cuenta para nadie.',
    stalled: 'La calificación no terminó',
    stalledNote:
      'Se inició una calificación pero no llegó ningún resultado. Actualice más tarde, o registre primero el precio de partida si falta.',
    reason: {
      missing_anchor: 'No se registró un precio de partida para esta ronda, así que no se puede calificar.',
      invalid_window: 'Las horas de inicio y fin no forman una ventana usable.',
      series_unavailable: 'No se pudo obtener la serie histórica de precios: nadie fue calificado.',
      no_series_data: 'El flujo no devolvió ningún cierre usable para esta ventana.',
      no_session_in_window: 'Ninguna sesión cerró dentro de esta ventana (fin de semana o festivo).',
      equal_close: 'El cierre coincidió exactamente con el precio de partida: nadie acierta ni falla.',
      not_price_instrument: 'Este instrumento no es un precio de mercado y no se puede calificar así.',
      unknown: 'Esta ronda no se puede calificar, así que no cuenta para nadie.',
    },
  },
  header: {
    atPrediction: 'al momento de la predicción',
    now: 'ahora',
    live: 'EN VIVO',
    headlineWithAnchor: (today, instrument, price, anchorDate) =>
      `${today} \u00b7 ${instrument} \u00b7 ${price}${anchorDate ? ` (${anchorDate})` : ''}`,
    headlineNoAnchor: (today, instrument) => `${today} \u00b7 ${instrument} \u00b7 precio de partida no disponible`,
    windowWithAnchor: (fromDate, fromPrice, toDate) =>
      `Medido desde el cierre del ${fromDate} de ${fromPrice}, se resuelve contra el cierre del ${toDate}.`,
    windowResolved: (fromDate, fromPrice, toDate, toPrice) =>
      `Medido desde el cierre del ${fromDate} de ${fromPrice}, resuelto contra el cierre del ${toDate} de ${toPrice}.`,
    windowAnchorOnly: (fromDate, fromPrice) =>
      `Medido desde el cierre del ${fromDate} de ${fromPrice}. La sesión de resolución aún no está registrada.`,
    windowNoSessionDates:
      'El precio de partida está registrado, pero no las fechas de sesión: no se infieren de las marcas de tiempo.',
    windowNoAnchor:
      'No se registró el precio de partida de esta predicción, así que no se muestra la cotización en vivo: sería el número equivocado para leer estas llamadas.',
    liveSecondary: 'ahora',
  },
  modelList: {
    title: (n) => `Modelos (${n})`,
    tierTab: 'Nivel',
    campTab: 'Bloque',
    empty: 'Todavía ningún modelo ha respondido.',
    correct: 'Acertó',
    missed: 'Falló',
    ungraded: 'Sin calificar',
  },
  modelTile: {
    modelLabel: 'Modelo',
    showWhy: '¿Por qué?',
    hideWhy: 'Ocultar',
    showOriginal: 'Mostrar original en inglés',
    hideOriginal: 'Ocultar original en inglés',
    originalLabel: 'Original',
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
    combinedTrack: (pct, n) => `precisión pasada de este método combinado ${pct}% (n=${n})`,
    combinedTrackPending: 'este método combinado aún está reuniendo su historial',
  },
  verdict: {
    title: 'Veredicto final',
    heroHits: (hits, graded) => `Esta ronda ${hits}/${graded} aciertos`,
    distributionUp: 'Subida',
    distributionDown: 'Bajada',
    distributionNoDirection: 'Sin dirección',
    sectionCamp: 'Bando',
    sectionTier: 'Nivel',
    sectionBook: 'Razonamiento vs investigación',
    sectionCountry: 'Por país',
    sectionCountryCaution: 'Las muestras por país son pequeñas (1–5 modelos): léalas como contexto, no como un ranking.',
    sectionOverconfident: 'Fallos por confianza',
    sectionStreaks: 'Rachas',
    campLabels: { us: 'EE. UU.', china: 'China', other: 'Otro' },
    tierLabels: { premier: 'PREMIER', challenger: 'CHALLENGER', world: 'WORLD', scout: 'SCOUT' },
    bookLabels: { closed: 'Libro cerrado', scout: 'Libro abierto (Scout)' },
    countryLabels: {
      US: 'Estados Unidos',
      CN: 'China',
      KR: 'Corea del Sur',
      FR: 'Francia',
      CA: 'Canadá',
      INT: 'Internacional',
    },
    rawCount: (hits, graded) => `${hits}/${graded}`,
    ungradedNote: (ungraded) => `+${ungraded} sin puntuar`,
    overconfidentConfidence: (confidence) => `${Math.round(confidence)}`,
    streakLine: (label, streak) => `${label} · ${streak} seguidas`,
    expandSection: 'Mostrar',
    collapseSection: 'Ocultar',
  },
  gating: {
    unavailable: 'Esta categoría de predicción todavía no está disponible en tu región.',
    tosNote: 'La disponibilidad depende del país declarado en tu cuenta y de tu ubicación detectada. Debes usar tu jurisdicción real: si intentas evadir esto (por ejemplo, con una VPN), asumes la responsabilidad de las consecuencias.',
  },
  languageToggleLabel: 'Idioma',
  leaderboard: {
    title: 'Tabla de posiciones',
    subtitle: 'Tasas de acierto calculadas solo con predicciones ya resueltas — esto no es asesoramiento de inversión.',
    tabs: { camp3: 'Bloque (3 vías)', tier: 'Nivel', brand: 'Marca', category: 'Categoría', korea: 'Corea' },
    moreComparisons: 'Más comparaciones',
    hideComparisons: 'Ocultar comparaciones',
    campHeadline: 'EE. UU. vs China',
    methodHeadline: 'Razonamiento puro vs investigación',
    methodLabels: { pure_reasoning: 'Razonamiento puro', research: 'Investigación (Scout)' },
    campLabels: { us: 'EE. UU.', china: 'China', other: 'Tercer país' },
    columns: { rank: '#', name: 'Nombre', winRate: 'Tasa de acierto', record: 'Registro' },
    roundCoverage: (graded, unresolvable) =>
      unresolvable > 0
        ? `Calculado con ${graded} rondas calificadas. ${unresolvable} ronda(s) no pudieron calificarse y no cuentan para nadie.`
        : `Calculado con ${graded} rondas calificadas.`,
    emptyState: 'Todavía no hay suficientes predicciones resueltas — vuelve a revisar a medida que se resuelvan más rondas.',
    asOf: (date) => `Actualizado al ${date}`,
    baselinesTitle: 'Líneas de referencia',
    baselinesNote:
      'No son participantes de la liga y no se clasifican. Sirven para leer el acierto de un modelo frente a una estrategia que no exige habilidad.',
    baselineBadge: 'Referencia',
    alwaysUp: 'Siempre al alza',
    alwaysUpHint: 'Predice alza en cada ronda',
    coinFlip: 'Cara o cruz',
    coinFlipHint: 'Línea esperada del 50 % — una marca, no una simulación',
    coinFlipRecord: 'Referencia',
    beatingAlwaysUp: (beating, compared) =>
      `${beating} de ${compared} modelos superan a «Siempre al alza»`,
    beatingAlwaysUpEmpty: 'Aún no hay rondas calificadas para comparar con «Siempre al alza».',
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
    freeNote: 'Los resultados recientes son gratis. El historial completo, filtros, fechas y la exportación CSV usan créditos.',
    deepCta: (credits) => `Abrir archivo profundo \u00b7 ${credits} créditos`,
    deepUnlocking: 'Abriendo archivo\u2026',
    exportCsv: 'Exportar CSV',
    filterModel: 'Id del modelo',
    filterFrom: 'Desde',
    filterTo: 'Hasta',
    applyFilters: 'Aplicar',
    headlineRecent: (correct, graded) =>
      graded > 0 ? `Últimamente: ${correct} de ${graded} llamadas de IA acertaron` : 'Aún no hay llamadas calificadas en la ventana reciente',
    latestRound: (instrument, outcome) => `Última: ${instrument} → ${outcome}`,
    insufficientCredits: (required, balance) => `El archivo profundo necesita ${required} créditos \u2014 tienes ${balance}.`,
  },
  hub: {
    title: 'Liga de predicción de IA',
    subtitle: 'Lo que predicen los modelos de IA del mundo \u2014 y con qué frecuencia acertaron.',
    tabs: { cards: 'Tarjetas', leaderboard: 'Tabla', recordRoom: 'Registros' },
    loading: 'Cargando\u2026',
    noInstruments: 'La liga todavía no está disponible en tu región.',
    generateLive: (credits) => `Preguntar a los modelos ahora \u00b7 ${credits} créditos`,
    generating: 'Consultando a los modelos\u2026',
    freeReadNote: 'Ver las tarjetas, la tabla y los registros recientes es gratis. Una ejecución en vivo o una consulta de archivo profundo consume créditos.',
    insufficientCredits: (required, balance) => `Una ejecución en vivo cuesta ${required} créditos \u2014 tienes ${balance}.`,
    rateLimited: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
    genericError: 'Algo salió mal. Inténtalo de nuevo.',
    balance: (credits) => `${credits} créditos`,
    deepOpen: (credits) => `An\u00e1lisis abierto \u00b7 ${credits} cr\u00e9ditos`,
    deepDebate: (credits) => `Debate a favor/en contra \u00b7 ${credits} cr\u00e9ditos`,
    deepRunning: 'Ejecutando an\u00e1lisis profundo\u2026',
    deepUnscoredNote:
      'Comentario sin puntuaci\u00f3n: no es una predicci\u00f3n de la liga. No entra en la clasificaci\u00f3n ni en el historial.',
    deepOpenTitle: 'An\u00e1lisis abierto',
    deepDebateTitle: 'Debate a favor/en contra',
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
    correlatedNote:
      'Premier و Challenger و World يقرأون حزمة البحث نفسها، فهذه حادثة واحدة بمدخلات مترابطة — وليست 40 توقّعًا مستقلًا.',
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
    realEstate: 'مرجع إحصائي فقط — وليس تقييمًا رسميًا. نظرة على المنطقة أو الأداة، لا تقدير لعقار بعينه.',
  },
  catalog: {
    categories: {
      sports: 'رياضة',
      crypto: 'عملات مشفرة',
      stocks: 'أسهم',
      fx: 'عملات',
      gold_metals: 'ذهب ومعادن',
      index_etf: 'مؤشرات / صناديق',
      commodities_energy: 'سلع وطاقة',
      politics_election: 'سياسة',
      entertainment: 'ترفيه',
      memecoin: 'ميم كوين',
      real_estate: 'عقارات',
      macro_econ: 'اقتصاد كلي',
    },
    instruments: {
      AAPL: 'أبل (AAPL)',
      NVDA: 'إنفيديا (NVDA)',
      TSLA: 'تسلا (TSLA)',
      'BTC/USD': 'بيتكوين (BTC)',
      'ETH/USD': 'إيثيريوم (ETH)',
      'SOL/USD': 'سولانا (SOL)',
      'EUR/USD': 'يورو / دولار',
      'USD/KRW': 'دولار / وون',
      'USD/JPY': 'دولار / ين',
      'XAU/USD': 'ذهب',
      'XAG/USD': 'فضة',
      SPX: 'S&P 500',
      NDX: 'ناسداك 100',
      'WTICO/USD': 'نفط غرب تكساس',
      'NATGAS/USD': 'غاز طبيعي',
      VNQ: 'فانغارد عقاري (VNQ)',
      SCHH: 'شواب ريت أمريكي (SCHH)',
      'DOGE/USD': 'دوجكوين (DOGE)',
      'SHIB/USD': 'شيبا إينو (SHIB)',
    },
    comingSoon: 'قريبًا',
    comingSoonHint: 'سيظهر هنا اختيار الأحداث والبحث بالسؤال. لا أدوات ثابتة لهذه الفئة.',
    macroEconHint: 'نظرة سوقية للخبراء — أسعار الفائدة والتضخم والسندات. عمق لا إثارة.',
    noCardYet: 'لا توجد بطاقة توقع لهذه الأداة بعد.',
  },
  hitRate: {
    pending: 'معدل الإصابة: قيد الحساب',
    withValue: (value) => `معدل الإصابة ${value}`,
    roundResult: (correct, graded) => `هذه الجولة: ${correct}/${graded} إصابة`,
  },
  winRate: {
    withSample: (pctText, n) => `${pctText}% (ن=${n})`,
    record: (wins, losses) => `${wins} فوز ${losses} خسارة`,
    insufficient: (wins, losses) => `${wins} فوز ${losses} خسارة (العيّنة غير كافية)`,
    insufficientNote: 'العيّنة غير كافية',
    rankingBegins: (minSample) =>
      `يبدأ الترتيب بعد ${minSample} جولة مُقيَّمة. وحتى ذلك الحين تُعرض النتائج دون ترتيب، بسجل الفوز والخسارة بدلًا من نسبة مئوية.`,
    noRounds: 'لا جولات مُقيَّمة',
  },
  grading: {
    inProgress: 'جارٍ التقييم…',
    pending: 'في انتظار التقييم',
    unresolvable: 'غير قابل للتقييم',
    unresolvableNote:
      'انتهى الموعد النهائي، لكن لا يمكن تقييم هذه الجولة بعدل — لذلك لم يُقيَّم أي نموذج فيها، ولا تُحسب لأي طرف.',
    stalled: 'لم يكتمل التقييم',
    stalledNote: 'بدأ التقييم لكن لم يصل أي نتيجة. حدّث لاحقًا، أو سجّل سعر البداية أولًا إن كان مفقودًا.',
    reason: {
      missing_anchor: 'لم يُسجَّل سعر بداية لهذه الجولة، لذلك لا يمكن تقييمها.',
      invalid_window: 'وقتا البداية والنهاية لا يشكّلان نافذة صالحة للتقييم.',
      series_unavailable: 'تعذّر جلب سلسلة الأسعار التاريخية، فلم يُقيَّم أحد.',
      no_series_data: 'لم يُرجع المصدر أي إغلاق صالح لهذه النافذة.',
      no_session_in_window: 'لم يُغلق أي يوم تداول داخل نافذة التنبؤ (عطلة أو عطلة نهاية الأسبوع).',
      equal_close: 'طابق الإغلاق سعر البداية تمامًا، فلا صواب ولا خطأ.',
      not_price_instrument: 'هذه الأداة ليست سعر سوق، ولا يمكن تقييمها بهذه الطريقة.',
      unknown: 'لا يمكن تقييم هذه الجولة، لذلك لا تُحسب لأي طرف.',
    },
  },
  header: {
    atPrediction: 'وقت التنبؤ',
    now: 'الآن',
    live: 'مباشر',
    headlineWithAnchor: (today, instrument, price, anchorDate) =>
      `${today} · ${instrument} · ${price}${anchorDate ? ` (${anchorDate})` : ''}`,
    headlineNoAnchor: (today, instrument) => `${today} · ${instrument} · سعر البداية غير متاح`,
    windowWithAnchor: (fromDate, fromPrice, toDate) =>
      `يُقاس من إغلاق ${fromDate} عند ${fromPrice}، ويُحسَم مقابل إغلاق ${toDate}.`,
    windowResolved: (fromDate, fromPrice, toDate, toPrice) =>
      `يُقاس من إغلاق ${fromDate} عند ${fromPrice}، وحُسِم مقابل إغلاق ${toDate} عند ${toPrice}.`,
    windowAnchorOnly: (fromDate, fromPrice) =>
      `يُقاس من إغلاق ${fromDate} عند ${fromPrice}. لم يُسجَّل بعد يوم الجلسة المستخدم في التقييم.`,
    windowNoSessionDates: 'سعر البداية مسجَّل لكن تواريخ الجلسات ليست كذلك — ولا تُستنتج من الطوابع الزمنية.',
    windowNoAnchor:
      'لم يُسجَّل سعر بداية هذا التنبؤ، لذلك لا يُعرض السعر المباشر — سيكون الرقم الخطأ لقراءة هذه التوقعات.',
    liveSecondary: 'الآن',
  },
  modelList: {
    title: (n) => `النماذج (${n})`,
    tierTab: 'الفئة',
    campTab: 'المعسكر',
    empty: 'لم يستجب أي نموذج بعد.',
    correct: 'إصابة',
    missed: 'خطأ',
    ungraded: 'غير مُقيَّم',
  },
  modelTile: {
    modelLabel: 'النموذج',
    showWhy: 'لماذا؟',
    hideWhy: 'إخفاء',
    showOriginal: 'إظهار الأصل الإنجليزي',
    hideOriginal: 'إخفاء الأصل الإنجليزي',
    originalLabel: 'الأصل',
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
    combinedTrack: (pct, n) => `دقة هذه الطريقة المجمّعة سابقًا ${pct}% (n=${n})`,
    combinedTrackPending: 'هذه الطريقة المجمّعة ما زالت تجمع سجلها',
  },
  verdict: {
    title: 'الحكم النهائي',
    heroHits: (hits, graded) => `هذه الجولة ${hits}/${graded} إصابة`,
    distributionUp: 'صعود',
    distributionDown: 'هبوط',
    distributionNoDirection: 'بلا اتجاه',
    sectionCamp: 'المعسكر',
    sectionTier: 'المستوى',
    sectionBook: 'استدلال مقابل بحث',
    sectionCountry: 'حسب الدولة',
    sectionCountryCaution: 'عينات الدول صغيرة (1–5 نماذج) — اقرأها كسياق لا كترتيب.',
    sectionOverconfident: 'أخطاء حسب الثقة',
    sectionStreaks: 'سلاسل الفوز',
    campLabels: { us: 'الولايات المتحدة', china: 'الصين', other: 'أخرى' },
    tierLabels: { premier: 'PREMIER', challenger: 'CHALLENGER', world: 'WORLD', scout: 'SCOUT' },
    bookLabels: { closed: 'كتاب مغلق', scout: 'كتاب مفتوح (Scout)' },
    countryLabels: {
      US: 'الولايات المتحدة',
      CN: 'الصين',
      KR: 'كوريا الجنوبية',
      FR: 'فرنسا',
      CA: 'كندا',
      INT: 'دولي',
    },
    rawCount: (hits, graded) => `${hits}/${graded}`,
    ungradedNote: (ungraded) => `+${ungraded} غير مُقيَّم`,
    overconfidentConfidence: (confidence) => `${Math.round(confidence)}`,
    streakLine: (label, streak) => `${label} · ${streak} متتالية`,
    expandSection: 'إظهار',
    collapseSection: 'إخفاء',
  },
  gating: {
    unavailable: 'فئة التوقعات هذه غير متاحة بعد في منطقتك.',
    tosNote: 'يعتمد الظهور على الدولة المسجَّلة في حسابك والموقع المكتشَف لاتصالك. يجب عليك استخدام نطاقك القضائي الحقيقي؛ وإذا حاولت تجاوز ذلك (عبر VPN مثلاً) فإنك تتحمل مسؤولية أي نتائج تترتب على ذلك.',
  },
  languageToggleLabel: 'اللغة',
  leaderboard: {
    title: 'لوحة الصدارة',
    subtitle: 'معدلات الإصابة محسوبة فقط من التوقعات التي تم حسمها — هذه ليست نصيحة استثمارية.',
    tabs: { camp3: 'المعسكر (ثلاثي)', tier: 'الفئة', brand: 'العلامة', category: 'التصنيف', korea: 'كوريا' },
    moreComparisons: 'مزيد من المقارنات',
    hideComparisons: 'إخفاء المقارنات',
    campHeadline: 'الولايات المتحدة مقابل الصين',
    methodHeadline: 'الاستدلال الصرف مقابل البحث',
    methodLabels: { pure_reasoning: 'الاستدلال الصرف', research: 'البحث (الكشافة)' },
    campLabels: { us: 'الولايات المتحدة', china: 'الصين', other: 'دولة ثالثة' },
    columns: { rank: '#', name: 'الاسم', winRate: 'معدل الإصابة', record: 'السجل' },
    roundCoverage: (graded, unresolvable) =>
      unresolvable > 0
        ? `محسوبة من ${graded} جولة مُقيَّمة. تعذّر تقييم ${unresolvable} جولة، ولا تُحسب لأي طرف.`
        : `محسوبة من ${graded} جولة مُقيَّمة.`,
    emptyState: 'لا توجد توقعات محسومة كافية بعد — عد لاحقًا مع حسم المزيد من الجولات.',
    asOf: (date) => `اعتبارًا من ${date}`,
    baselinesTitle: 'خطوط مرجعية',
    baselinesNote:
      'ليست مشاركين في الدوري ولا تُرتَّب. وُجدت لتُقرأ نسبة إصابة النموذج مقابل استراتيجية لا تحتاج مهارة.',
    baselineBadge: 'مرجع',
    alwaysUp: 'دائمًا صعود',
    alwaysUpHint: 'يتوقع الصعود في كل جولة',
    coinFlip: 'رمي عملة',
    coinFlipHint: 'خط 50٪ المتوقع — علامة مرجعية لا محاكاة',
    coinFlipRecord: 'مرجع',
    beatingAlwaysUp: (beating, compared) =>
      `${beating} من ${compared} نماذج تتفوّق على «دائمًا صعود»`,
    beatingAlwaysUpEmpty: 'لا جولات مُقيَّمة بعد لمقارنتها بـ«دائمًا صعود».',
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
    freeNote: 'النتائج الأخيرة مجانية. السجل الكامل والتصفية والتواريخ وتصدير CSV تستهلك رصيدًا.',
    deepCta: (credits) => `فتح الأرشيف العميق · ${credits} رصيد`,
    deepUnlocking: 'جارٍ فتح الأرشيف…',
    exportCsv: 'تصدير CSV',
    filterModel: 'معرّف النموذج',
    filterFrom: 'من',
    filterTo: 'إلى',
    applyFilters: 'تطبيق',
    headlineRecent: (correct, graded) =>
      graded > 0 ? `مؤخرًا: أصاب ${correct} من أصل ${graded} نداءات ذكاء اصطناعي` : 'لا نداءات مُقيَّمة في النافذة الأخيرة بعد',
    latestRound: (instrument, outcome) => `الأحدث: ${instrument} → ${outcome}`,
    insufficientCredits: (required, balance) => `يتطلب الأرشيف العميق ${required} من الرصيد — لديك ${balance}.`,
  },
  hub: {
    title: 'دوري التوقعات بالذكاء الاصطناعي',
    subtitle: 'ما تتوقعه نماذج الذكاء الاصطناعي حول العالم — ومدى دقتها فعليًا.',
    tabs: { cards: 'البطاقات', leaderboard: 'لوحة الصدارة', recordRoom: 'غرفة السجلات' },
    loading: 'جارٍ التحميل…',
    noInstruments: 'الدوري غير متاح بعد في منطقتك.',
    generateLive: (credits) => `اسأل النماذج الآن · ${credits} رصيد`,
    generating: 'جارٍ سؤال النماذج…',
    freeReadNote: 'تصفح البطاقات ولوحة الصدارة والنتائج الأخيرة مجاني. التشغيل المباشر أو استعلام الأرشيف العميق يستهلك الرصيد.',
    insufficientCredits: (required, balance) => `يتطلب التشغيل المباشر ${required} من الرصيد — لديك ${balance}.`,
    rateLimited: 'طلبات كثيرة جدًا. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى.',
    genericError: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
    balance: (credits) => `${credits} رصيد`,
    deepOpen: (credits) => `تحليل مفتوح \u00b7 ${credits} رصيد`,
    deepDebate: (credits) => `مناظرة مع/ضد \u00b7 ${credits} رصيد`,
    deepRunning: 'جارٍ التحليل المعمّق\u2026',
    deepUnscoredNote: 'تعليق غير مُقيَّم — ليس توقعًا للدوري ولا يدخل لوحة الصدارة أو السجل.',
    deepOpenTitle: 'تحليل مفتوح',
    deepDebateTitle: 'مناظرة مع/ضد',
  },
}

/** Structural stub — Brazil scope is intentionally deferred. Spreads English so the shape is always complete, then overrides new chrome so Portuguese does not ship English fallbacks. */
const pt: LeagueUiPack = {
  ...en,
  header: {
    ...en.header,
    windowResolved: (fromDate, fromPrice, toDate, toPrice) =>
      `Medido a partir do fechamento de ${fromDate} em ${fromPrice}, resolvido contra o fechamento de ${toDate} em ${toPrice}.`,
    windowAnchorOnly: (fromDate, fromPrice) =>
      `Medido a partir do fechamento de ${fromDate} em ${fromPrice}. A sessão de resolução ainda não foi registrada.`,
    windowNoSessionDates:
      'O preço inicial está registrado, mas as datas de sessão desta previsão não — essas datas não são inferidas de carimbos de tempo.',
  },
  verdict: {
    title: 'Veredito final',
    heroHits: (hits, graded) => `Nesta rodada ${hits}/${graded} acertos`,
    distributionUp: 'Alta',
    distributionDown: 'Baixa',
    distributionNoDirection: 'Sem direção',
    sectionCamp: 'Campo',
    sectionTier: 'Nível',
    sectionBook: 'Raciocínio vs pesquisa',
    sectionCountry: 'Por país',
    sectionCountryCaution: 'Amostras por país são pequenas (1–5 modelos) — leia como contexto, não como ranking.',
    sectionOverconfident: 'Erros por confiança',
    sectionStreaks: 'Sequências',
    campLabels: { us: 'EUA', china: 'China', other: 'Outro' },
    tierLabels: { premier: 'PREMIER', challenger: 'CHALLENGER', world: 'WORLD', scout: 'SCOUT' },
    bookLabels: { closed: 'Livro fechado', scout: 'Livro aberto (Scout)' },
    countryLabels: {
      US: 'Estados Unidos',
      CN: 'China',
      KR: 'Coreia do Sul',
      FR: 'França',
      CA: 'Canadá',
      INT: 'Internacional',
    },
    rawCount: (hits, graded) => `${hits}/${graded}`,
    ungradedNote: (ungraded) => `+${ungraded} sem nota`,
    overconfidentConfidence: (confidence) => `${Math.round(confidence)}`,
    streakLine: (label, streak) => `${label} · ${streak} seguidas`,
    expandSection: 'Mostrar',
    collapseSection: 'Ocultar',
  },
}

export const LEAGUE_UI: Record<LeagueLocale, LeagueUiPack> = { en, ko, ja, 'zh-TW': zhTW, fr, ar, es, pt }

export function getLeagueUiPack(locale: LeagueLocale): LeagueUiPack {
  return LEAGUE_UI[locale] ?? LEAGUE_UI.en
}
