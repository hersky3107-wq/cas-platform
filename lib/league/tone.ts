import type { ColorBucket } from './card-types'

/**
 * AI Prediction League — TONE SYSTEM (Layer 3).
 *
 * Maps `color_bucket` (green/yellow/red, set by the orchestrator from the
 * round's category — see `CATEGORY_COLOR` in `lib/league/orchestrator.ts`) to
 * a small set of visual-intensity tokens.
 *
 * HARD RULE: tone changes STYLING and WORDING INTENSITY ONLY. It must never
 * change compliance behavior — the disclaimer always renders, the phrasing
 * templates in `compliance.ts` are the same regardless of tone, and no tone
 * unlocks any additional UI (no odds, no buy/sell language at any intensity).
 * `disclaimerWeight` only changes how PROMINENT the same disclaimer text is.
 *
 * The current league is finance-only, so rounds are mostly green/yellow
 * (see `CATEGORY_COLOR`) — green is the well-trodden, "make this look good
 * first" path. Yellow/red are fully wired but will see little real traffic
 * until non-finance categories (sports/politics/entertainment) go live.
 *
 * The actual color values live in `app/globals.css` under
 * `[data-league-tone='green|yellow|red']`, mirroring the existing
 * `[data-jeju-theme='...']` pattern (the one precedent for a scoped
 * tone/theme token system already in this codebase — there is no earlier
 * league-specific mockup to reuse tokens from). Components apply the tone by
 * setting `data-league-tone` on the card root; Tailwind utilities like
 * `bg-league-accent` / `border-league-border` pick the value up automatically.
 */

export type ToneIntensity = 'calm' | 'elevated' | 'urgent'
export type DisclaimerWeight = 'default' | 'emphasized' | 'prominent'

export type ToneTokens = {
  bucket: ColorBucket
  /** Value to set on the card root's `data-league-tone` attribute. */
  dataAttr: ColorBucket
  label: string
  intensity: ToneIntensity
  /** Which disclaimer copy variant to prefer (still always both-available). */
  disclaimerWeight: DisclaimerWeight
  /** Whether the consensus headline's confidence number gets extra visual weight. */
  emphasizeProbability: boolean
}

export const TONE_TOKENS: Record<ColorBucket, ToneTokens> = {
  green: {
    bucket: 'green',
    dataAttr: 'green',
    label: 'Calm',
    intensity: 'calm',
    disclaimerWeight: 'default',
    emphasizeProbability: false,
  },
  yellow: {
    bucket: 'yellow',
    dataAttr: 'yellow',
    label: 'Elevated',
    intensity: 'elevated',
    disclaimerWeight: 'emphasized',
    emphasizeProbability: true,
  },
  red: {
    bucket: 'red',
    dataAttr: 'red',
    label: 'High attention',
    intensity: 'urgent',
    disclaimerWeight: 'prominent',
    emphasizeProbability: true,
  },
}

export function toneFor(bucket: ColorBucket): ToneTokens {
  return TONE_TOKENS[bucket]
}
