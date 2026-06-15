/**
 * APEX — single source of truth for model configuration.
 *
 * To update APEX when a provider ships a newer flagship:
 *   1. Change APEX_MODEL[provider] to the new model ID.
 *   2. Update APEX_MODEL_META[provider] (label + since).
 *   3. Optionally set APEX_MODEL_FALLBACK[provider] if the new model is in preview.
 *   4. Flip APEX_ANNOUNCEMENT.active = true and set a message/date if the swap is
 *      worth surfacing to users.
 *   5. Commit. This is the ONLY file that needs editing for a model update.
 *
 * Note on Claude Fable 5 (Mythos-class, released 2026-06-09):
 *   Fable 5 is newer than Opus 4.8 and technically the strongest Anthropic model,
 *   but is kept off APEX for now due to API stability / refusal-classifier concerns.
 *   Revisit swapping anthropic → 'claude-fable-5' once it has proven stable in
 *   production use.
 */

import type { AiProviderName } from '@/lib/ai/router'
import { BRAND, AI_COLORS } from '@/lib/synod/debaters'

// Re-export SYNOD's BRAND and AI_COLORS directly. SynodProvider and AiProviderName
// are structurally identical unions (both: openai|anthropic|google|xai|deepseek|mistral),
// so this cast is safe. Keeping one source avoids brand-name drift between modules.
export { BRAND, AI_COLORS }

// ── 1. Provider order ────────────────────────────────────────────────────────

export const APEX_PROVIDERS: AiProviderName[] = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'mistral',
]

// ── 2. Primary flagship model IDs ────────────────────────────────────────────

export const APEX_MODEL: Record<AiProviderName, string> = {
  openai: 'gpt-5.5',
  anthropic: 'claude-opus-4-8',
  // Gemini 3.1 'Ultra' has no confirmed public generativelanguage API model ID as of 2026-06;
  // using gemini-3.1-pro-preview (the documented flagship API ID). Revisit if/when an Ultra
  // API ID is published. Bare 'gemini-3.1-pro' (no -preview) returns 404.
  google: 'gemini-3.1-pro-preview',
  xai: 'grok-4.20',
  deepseek: 'deepseek-v4-pro',
  mistral: 'mistral-medium-3.5',
}

// ── 3. Fallback model IDs (partial — omit when no fallback needed) ────────────

/** Used when the primary model returns a hard error (e.g. preview-gate 403/429). */
export const APEX_MODEL_FALLBACK: Partial<Record<AiProviderName, string>> = {
  // Fall back to a known-good model (used successfully by SYNOD/router) if the preview is unavailable.
  google: 'gemini-3.5-flash',
}

// ── 4. Synthesis model ───────────────────────────────────────────────────────

/** The chair that synthesizes the 6 parallel answers into one APEX verdict. */
export const APEX_SYNTHESIS_MODEL = 'claude-opus-4-8'

// ── 5. Display metadata per provider ─────────────────────────────────────────

export type ApexModelMeta = {
  /** Human-facing model label shown in the APEX UI. */
  label: string
  /** YYYY-MM release month — drives the isApexNew badge. */
  since: string
}

export const APEX_MODEL_META: Record<AiProviderName, ApexModelMeta> = {
  openai: { label: 'GPT-5.5', since: '2026-04' },
  anthropic: { label: 'Claude Opus 4.8', since: '2026-05' },
  google: { label: 'Gemini 3.1 Pro', since: '2026-02' },
  xai: { label: 'Grok 4.20', since: '2026-03' },
  deepseek: { label: 'DeepSeek V4 Pro', since: '2026-04' },
  mistral: { label: 'Mistral Medium 3.5', since: '2026-04' },
}

// ── 7. "NEW" badge helper ─────────────────────────────────────────────────────

const APEX_NEW_WINDOW_DAYS = 60

/**
 * Returns true if the model's `since` month is within ~60 days of today.
 * Accepts 'YYYY-MM' strings. Returns false on any parse failure so UI stays safe.
 */
export function isApexNew(since: string): boolean {
  try {
    const [year, month] = since.split('-').map(Number)
    if (!year || !month) return false
    // First day of the release month as UTC
    const releaseDate = new Date(Date.UTC(year, month - 1, 1))
    const now = Date.now()
    const diffMs = now - releaseDate.getTime()
    const diffDays = diffMs / (1000 * 60 * 60 * 24)
    return diffDays >= 0 && diffDays <= APEX_NEW_WINDOW_DAYS
  } catch {
    return false
  }
}

// ── 8. Announcement banner ────────────────────────────────────────────────────

export type ApexAnnouncement = {
  /** Set to true to show the banner in the APEX UI. */
  active: boolean
  /** Markdown-safe announcement text. */
  message: string
  /** Display date string, e.g. '2026-07-01'. */
  date: string
}

export const APEX_ANNOUNCEMENT: ApexAnnouncement = {
  active: false,
  message: '',
  date: '',
}
