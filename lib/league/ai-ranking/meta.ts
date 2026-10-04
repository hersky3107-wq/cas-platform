/** Shared LMArena constants. Pure — safe for client display and server ingest. */

export const LMARENA_DATASET = 'lmarena-ai/leaderboard-dataset'
export const LMARENA_SOURCE = 'lmarena'
export const LMARENA_LICENSE = 'cc-by-4.0'
export const LMARENA_ATTRIBUTION = '순위 데이터: LMArena (CC BY 4.0)'

/**
 * Public LMArena default since 2025-05-16 is style control for text / vision
 * (HF config `text_style_control` is `default: true`). Packet + grading read
 * these store arenas; the AIRANK instrument still says `text` / `vision` / `search`.
 */
export const LMARENA_PUBLIC_STORE_ARENA: Record<string, string> = {
  text: 'text_style_control',
  vision: 'vision_style_control',
  search: 'search_style_control',
}

export function leaderboardStoreArena(arena: string): string {
  return LMARENA_PUBLIC_STORE_ARENA[arena] ?? arena
}
