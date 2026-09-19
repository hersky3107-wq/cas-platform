/**
 * League-divination calculation layer. PARALLEL to the oracle 3-way phase
 * axes — this module never writes PHASE_AXES / ReadingScope, never calls
 * projectTarot / projectSaju / projectRune, and never imports lib/league.
 *
 * Bump LEAGUE_DIVINATION_VERSION when a vote, seed, or aggregator rule changes.
 */
export const LEAGUE_DIVINATION_VERSION = '1.4.0'

/**
 * Pin every timing chart to Seoul so a cached pack cannot vary by viewer.
 * Hour 23:xx is rewritten to 22:xx so fourPillars never takes the 자시 fork
 * (zi_start vs civil_midnight). PRODUCT location, not a 택일 "명당".
 */
export const LEAGUE_SEOUL = {
  lat: 37.5665,
  lng: 126.978,
  tz: 'Asia/Seoul',
} as const

/** 23:00–23:59 → this hour, same civil minute. Avoids 야자시 day-pillar split. */
export const LEAGUE_PINNED_LATE_HOUR = 22

export const LEAGUE_VOTE_WEIGHTS = {
  iching: 3,
  tarot: 2,
  runes: 2,
  taeil: 2,
} as const

/**
 * PRODUCT: when 월건 opposes 일진, 택일 still votes (no veto) but its
 * applied contribution is this fraction of the nominal weight. The table
 * above does not change.
 */
export const TAEIL_MONTH_OPPOSE_FACTOR = 0.5

/**
 * PRODUCT: confidence multiplies the weighted margin by head count / this
 * seat count (votedCount / 4), not remainingWeight / 9. A lone 육효 seat
 * must not read as maximum certainty — the weight-based version would
 * score 3/9 = 0.33 and still look like a real four-seat reading.
 */
export const LEAGUE_CONFIDENCE_SEAT_COUNT = 4

export const LEAGUE_DRAW_SYSTEMS = ['iching', 'tarot', 'runes'] as const
export const LEAGUE_TIMING_SYSTEMS = ['taeil'] as const

/** 5-card spread; ballot reads Outcome only. First-N shuffle, no fan pick. */
export const LEAGUE_TAROT_SPREAD = 5 as const
export const LEAGUE_TAROT_PICKS: readonly number[] = [1, 2, 3, 4, 5]
export const LEAGUE_TAROT_BALLOT_LABEL = 'Outcome'

/** 3-stone Norns; ballot reads Future only. First-N cloth, no pick. */
export const LEAGUE_RUNE_COUNT = 3
export const LEAGUE_RUNE_BALLOT_LABEL = 'Future'

export const LEAGUE_DRAW_SEED_SYSTEMS = ['iching', 'tarot', 'runes'] as const
export type LeagueDrawSeedSystem = (typeof LEAGUE_DRAW_SEED_SYSTEMS)[number]

/**
 * Single reader seat. NAVER HCX-007 (clova:hcx-007) — Korean-native, already
 * gated 20/20 on oracle reading. Qwen 3.5 Flash failed this pack 0/20
 * (English CoT dumped into content, finish=length). thinking:none so the
 * 12s seat stays intact; oracle name-seat `thinking:low` measured 11–23s
 * and would miss the timeout.
 *
 * Cost: NAVER CLOVA does not return per-call billed USD. Published pricing is
 * ₩0.005 / token ($3.70 / 1M tokens at ~1,350 KRW/USD). A typical league
 * round runs ~600 prompt tokens + ~200 completion tokens (~800 tokens total),
 * giving an estimated cost of ~$0.003 USD (~₩4.0 KRW) per round, flagged
 * costIsEstimated: true.
 */
export const LEAGUE_READER_BRAND = 'NAVER'
export const LEAGUE_READER_DISPLAY_NAME = 'HyperCLOVA X HCX-007'
export const LEAGUE_READER_MODEL = 'HCX-007'
export const LEAGUE_READER_PLATFORM_ID = 'clova:hcx-007'
export const LEAGUE_READER_PRICE_PER_M_TOKENS_USD = 3.7
export const LEAGUE_READER_ESTIMATED_ROUND_TOKENS = 800
export const LEAGUE_READER_ESTIMATED_COST_USD = 0.003
export const LEAGUE_READER_COST_IS_ESTIMATED = true
/** CLOVA honors `thinking.effort`; `none` is the 12s path. Do not raise to low. */
export const LEAGUE_READER_EXTRA_REQUEST_PARAMS = { thinking: { effort: 'none' } } as const
export const LEAGUE_READER_MAX_COMPLETION_TOKENS = 500
export const LEAGUE_READER_TIMEOUT_MS = 12_000
export const LEAGUE_READER_LINE_MIN = 4
export const LEAGUE_READER_LINE_MAX = 5
export const LEAGUE_READER_RATIONALE_MAX_CHARS = 600
