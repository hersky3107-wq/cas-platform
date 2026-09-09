import { PUBLIC_CATEGORY_IDS, type PublicCategoryId } from '../catalog'
import { isUiHorizon, type UiHorizon } from '../horizon'
import type { PropositionKind } from './types'

/**
 * Normalizer PORT + schema gate.
 *
 * Live implementation: `createLlmNormalizer` / `createLiveNormalizer`
 * (gemini-3.5-flash-lite, one JSON retry). Tests keep `createStubNormalizer`.
 *
 * CONTRACT:
 *  - Input: raw user text + the chip the user is on + locale.
 *    The category is ALWAYS known; this never routes.
 *  - Output: JSON-parsed structured object as `unknown`, or `null` after
 *    one malformed-JSON retry. The shell trusts NOTHING until
 *    `validateNormalizerOutput` builds a fresh object.
 *  - User text sits in a delimited untrusted-data block (mitigation).
 *    The DEFENSE is this validator: enums, clamped confidence, dropped
 *    unknown fields, `entity_id_hint` as a lookup key only.
 */
export type NormalizerRequest = {
  raw_text: string
  /** The chip the user typed under — authoritative for adapter selection. */
  category_id: PublicCategoryId | string
  locale: string
}

export interface PromptNormalizer {
  normalize(req: NormalizerRequest): Promise<unknown | null>
}

/** The shape a well-behaved normalizer returns (validated field by field, never trusted as a whole). */
export type ValidatedNormalizerOutput = {
  category_id: PublicCategoryId
  /** Transient — used for resolution only, never persisted outside audit. */
  entity_mention: string
  /** Lookup key for the adapter's resolver. NEVER trusted as an entity. */
  entity_id_hint: string | null
  horizon: UiHorizon | null
  proposition_kind: PropositionKind
  slots: Record<string, string>
  /** Clamped to 0..1. */
  confidence: number
  needs_slot: string | null
}

const PROPOSITION_KINDS: readonly PropositionKind[] = [
  'binary_close_higher',
  'binary_subject_outcome',
  'binary_threshold',
]

const MAX_MENTION_CHARS = 200
const MAX_HINT_CHARS = 40
const MAX_SLOTS = 8
const MAX_SLOT_CHARS = 80

/**
 * Strict schema gate between the normalizer LLM and everything else.
 * Returns null on ANY structural violation (→ `low_confidence` refusal).
 * Builds a FRESH object so unknown fields can never ride along.
 */
export function validateNormalizerOutput(raw: unknown): ValidatedNormalizerOutput | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  const categoryId = o.category_id
  if (typeof categoryId !== 'string' || !(PUBLIC_CATEGORY_IDS as readonly string[]).includes(categoryId)) {
    return null
  }

  const kind = o.proposition_kind
  if (typeof kind !== 'string' || !(PROPOSITION_KINDS as readonly string[]).includes(kind)) return null

  const mention = typeof o.entity_mention === 'string' ? o.entity_mention.slice(0, MAX_MENTION_CHARS) : ''

  const hintRaw = o.entity_id_hint
  const hint = typeof hintRaw === 'string' && hintRaw.trim() ? hintRaw.trim().slice(0, MAX_HINT_CHARS) : null

  // Non-enum horizon is DISCARDED (→ clarify), not an outright rejection: a
  // model hallucinating '2w' should cost the user a chip tap, not a refusal.
  const horizon = isUiHorizon(o.horizon) ? o.horizon : null

  const confidenceRaw = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : 0
  const confidence = Math.min(1, Math.max(0, confidenceRaw))

  const slots: Record<string, string> = {}
  if (typeof o.slots === 'object' && o.slots !== null && !Array.isArray(o.slots)) {
    for (const [k, v] of Object.entries(o.slots as Record<string, unknown>)) {
      if (Object.keys(slots).length >= MAX_SLOTS) break
      if (typeof v === 'string') slots[k.slice(0, MAX_SLOT_CHARS)] = v.slice(0, MAX_SLOT_CHARS)
    }
  }

  const needsSlot = typeof o.needs_slot === 'string' && o.needs_slot.trim() ? o.needs_slot.trim() : null

  return {
    category_id: categoryId as PublicCategoryId,
    entity_mention: mention,
    entity_id_hint: hint,
    horizon,
    proposition_kind: kind as PropositionKind,
    slots,
    confidence,
    needs_slot: needsSlot,
  }
}

/** Table-driven stub so the shell and adapters are testable without any LLM. */
export function createStubNormalizer(fn: (req: NormalizerRequest) => unknown | null): PromptNormalizer {
  return {
    async normalize(req) {
      return fn(req)
    },
  }
}
