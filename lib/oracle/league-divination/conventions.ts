/**
 * League-divination calculation layer. PARALLEL to the oracle 3-way phase
 * axes — this module never writes PHASE_AXES / ReadingScope, never calls
 * projectTarot / projectSaju / projectRune, and never imports lib/league.
 *
 * Bump LEAGUE_DIVINATION_VERSION when a vote, seed, or aggregator rule changes.
 */
export const LEAGUE_DIVINATION_VERSION = '1.1.0'

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
 * Single reader seat. Qwen 3.5 Flash (openrouter:qwen3.5-flash) — CJK-native
 * flash model, already verified in PLATFORM_MODEL_REGISTRY, list $0.065 /
 * $0.26 per 1M. Compact pack ≈2k in + 400 out ≈ $0.00023, well under $0.002.
 * Reasoning effort:minimal so hidden thinking cannot eat the 500-token cap.
 * Phi-4 is a hair cheaper but weaker Korean; Gemini 3.6 Flash overshoots the
 * cost cap on a 2k prompt.
 */
export const LEAGUE_READER_BRAND = 'Qwen'
export const LEAGUE_READER_DISPLAY_NAME = 'Qwen3.5 Flash'
export const LEAGUE_READER_MODEL = 'qwen/qwen3.5-flash-02-23'
export const LEAGUE_READER_PLATFORM_ID = 'openrouter:qwen3.5-flash'
export const LEAGUE_READER_MAX_COMPLETION_TOKENS = 500
export const LEAGUE_READER_TIMEOUT_MS = 12_000
export const LEAGUE_READER_LINE_MIN = 4
export const LEAGUE_READER_LINE_MAX = 5
export const LEAGUE_READER_RATIONALE_MAX_CHARS = 600
