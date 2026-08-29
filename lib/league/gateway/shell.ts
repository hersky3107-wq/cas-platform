import { LEAGUE_GENERATE_CREDITS } from '../credits'
import { isCategoryAllowed } from '../jurisdiction/resolve'
import type { PublicCategoryId } from '../catalog'
import { validateNormalizerOutput, type PromptNormalizer } from './normalizer'
import { refusalMessageForKey, refusalMessageKey } from './refusal-copy'
import type {
  CategoryAdapter,
  ClarifyingQuestion,
  GatewayResult,
  GatewayViewer,
  NormalizeSlots,
  Refusal,
  RefusalCode,
} from './types'

/**
 * GATEWAY SHELL — category-blind by contract.
 *
 * Owns: the order of operations, the normalizer schema gate, the global
 * jurisdiction matrix, cheap pre-LLM filters, the refuse/clarify/ready
 * envelope, and CHARGE ORDERING. It holds zero category knowledge — every
 * judgment call is delegated to the `CategoryAdapter` the chip selects.
 *
 * ORDER OF OPERATIONS (design steps; 1–2 live in the HTTP route):
 *   1. Auth                        → 401 (route: `resolveLeagueViewer`)
 *   2. Rate limit                  → 429 (route: `enforceRateLimit`)
 *   3. Adapter pick                → refused `category_unavailable`
 *   4. Jurisdiction (matrix, then adapter overlay) → refused, no charge
 *   4½. Layer-0 pre-filters (no LLM, no DB)        → refused, no charge
 *   5. NORMALIZE (LLM port, stubbed) + strict schema validation
 *   6. Entity resolution + isDecidable → clarify OR refused, no charge
 *   7. composeProposition (server template only)
 *   8. Credits deduct — STRICTLY after a decidable, composed proposition
 *   9. ready → caller runs ensureRound + generatePredictions
 *
 * A user can never pay for a proposition that turned out ungradeable:
 * `deductCredits` is unreachable before `isDecidable === true` and
 * `composeProposition` returned. Refusal and clarify NEVER charge.
 *
 * NOT in this pass: the real normalizer LLM (stubbed behind
 * `PromptNormalizer`), normalize-quota/caching layers, and any UI wiring —
 * this function is server-side only.
 */

export type GatewayRequest = {
  viewer: GatewayViewer
  /** The chip the user typed under — authoritative for adapter selection. */
  category_id: PublicCategoryId | string
  raw_text: string
  locale: string
  /**
   * Answers from a previous `clarify` round-trip, keyed by question slot
   * (option ids only — chip taps, never free text).
   */
  answered_slots?: Record<string, string>
}

export type GatewayDeps = {
  adapterFor(categoryId: string): CategoryAdapter | null
  normalizer: PromptNormalizer
  /**
   * Deducts the league-generate charge. Injected so ordering is testable and
   * so admin-skip stays where it lives today (`deductCreditsBalance`).
   */
  deductCredits(viewer: GatewayViewer, credits: number): Promise<{ ok: boolean }>
  now?: () => Date
}

/** Layer-0 pre-filter bounds — freeform propositions don't need more. */
const MIN_RAW_CHARS = 4
const MAX_RAW_CHARS = 200

function refused(code: RefusalCode, locale: string, safe_facts?: Record<string, string>): GatewayResult {
  const key = refusalMessageKey(code)
  const refusal: Refusal & { message: string } = {
    code,
    message_i18n_key: key,
    message: refusalMessageForKey(key, locale),
    ...(safe_facts ? { safe_facts } : {}),
  }
  return { status: 'refused', refusal }
}

function refusedFrom(refusal: Refusal, locale: string): GatewayResult {
  return {
    status: 'refused',
    refusal: { ...refusal, message: refusalMessageForKey(refusal.message_i18n_key, locale) },
  }
}

/**
 * Layer-0 pre-filters: reject junk before any model call. Deliberately
 * returns the SAME refusal shape as a post-normalize refusal so a probing
 * caller cannot distinguish "filtered cheaply" from "normalized and refused".
 */
function prefilterRejects(rawText: string): boolean {
  const text = rawText.trim()
  if (text.length < MIN_RAW_CHARS || text.length > MAX_RAW_CHARS) return true
  // Must contain Hangul or Latin alphanumerics; rejects emoji-only, URL-junk-only, control chars.
  if (!/[A-Za-z0-9\uAC00-\uD7A3]/.test(text)) return true
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return true
  return false
}

export async function runLeagueGateway(req: GatewayRequest, deps: GatewayDeps): Promise<GatewayResult> {
  const { viewer, locale } = req
  const now = deps.now?.() ?? new Date()

  // 3. Adapter pick — an unknown chip and a chip with no adapter yet are the
  //    same product answer: this category is not open for freeform input.
  const adapter = deps.adapterFor(String(req.category_id))
  if (!adapter) return refused('category_unavailable', locale)

  // 4. Jurisdiction: global matrix first (admin bypasses, mirroring
  //    `viewerCanSeeCategory`), then the adapter's category overlay.
  if (!viewer.isAdmin && !isCategoryAllowed(adapter.ledger_category, viewer.jurisdiction, now.getTime())) {
    return refused('jurisdiction_blocked', locale)
  }
  const overlay = adapter.jurisdictionGate(viewer, now)
  if (overlay) return refusedFrom(overlay, locale)

  // 4½. Layer-0 pre-filters — zero LLM cost for junk.
  if (prefilterRejects(req.raw_text)) return refused('low_confidence', locale)

  // 5. Normalize (stubbed LLM port) + strict schema gate. Malformed output
  //    (null from the port, or any schema violation) is a refusal, not a 500.
  const rawOutput = await deps.normalizer.normalize({
    raw_text: req.raw_text,
    category_id: adapter.category_id,
    locale,
  })
  const normalized = rawOutput === null ? null : validateNormalizerOutput(rawOutput)
  if (!normalized) return refused('low_confidence', locale)

  // The chip is authoritative; a normalizer that disagrees about the category
  // is a wrong parse, not a routing instruction.
  if (normalized.category_id !== adapter.category_id) return refused('low_confidence', locale)

  if (normalized.confidence < 0.55) return refused('low_confidence', locale)

  const answered = req.answered_slots ?? {}

  // 6a. Entity resolution — server-side resolver only. Priority: an answered
  //     clarify chip beats the hint, the hint (a mere lookup key) beats the
  //     transient mention.
  const mentionCandidates = [answered.entity_id, normalized.entity_id_hint, normalized.entity_mention].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  )
  let entity: { entity_id: string; entity_kind: NormalizeSlots['entity_kind']; label: string } | null = null
  let entityAsk: ClarifyingQuestion | null = null
  let entityRefusal: Refusal | null = null
  for (const candidate of mentionCandidates) {
    const resolution = await adapter.resolveEntity(candidate, locale)
    if (resolution.ok) {
      entity = { entity_id: resolution.entity_id, entity_kind: resolution.entity_kind, label: resolution.label }
      entityAsk = null
      entityRefusal = null
      break
    }
    if ('need' in resolution && !entityAsk) entityAsk = resolution.need
    if ('refuse' in resolution && !entityRefusal) entityRefusal = resolution.refuse
  }
  if (!entity) {
    if (entityAsk) return { status: 'clarify', questions: [entityAsk], partial: { horizon: normalized.horizon } }
    return refusedFrom(entityRefusal ?? { code: 'unsupported_entity', message_i18n_key: refusalMessageKey('unsupported_entity') }, locale)
  }

  // 6b. Assemble slots: normalizer fields + clarify answers. Horizon answers
  //     are enum-gated the same way the normalizer's horizon was.
  const answeredHorizon = answered.horizon === '1d' || answered.horizon === '1w' || answered.horizon === '1m' || answered.horizon === '3m' ? answered.horizon : null
  const slots: NormalizeSlots = {
    category_id: adapter.category_id,
    entity_id: entity.entity_id,
    entity_kind: entity.entity_kind,
    entity_label: entity.label,
    horizon: answeredHorizon ?? normalized.horizon,
    resolve_by: null,
    proposition_kind: normalized.proposition_kind,
    slots: { ...normalized.slots, ...answered },
    confidence: normalized.confidence,
  }

  // 6c. Decidability — the charge gate. Missing slots become clarify chips.
  if (!adapter.isDecidable(slots)) {
    const questions = adapter.clarifyingQuestions(slots)
    if (questions.length > 0) return { status: 'clarify', questions, partial: slots }
    return refused('missing_slot', locale)
  }

  // 6d. Mid-band confidence (0.55–0.85): decidable but not confidently parsed
  //     → one confirm chip instead of a silent best-effort paid round.
  //     `entity_confirmed` arrives via answered_slots on the retry.
  if (slots.confidence < 0.85 && slots.slots.entity_confirmed !== 'true') {
    return {
      status: 'clarify',
      questions: [
        {
          slot: 'entity_confirmed',
          prompt_i18n_key: 'league.gateway.clarify.confirm_entity',
          options: [{ id: 'true', label_i18n_key: 'league.gateway.clarify.option.confirm_yes' }],
        },
      ],
      partial: slots,
    }
  }

  // 7. Server-composed proposition — the only text users/models ever see.
  const round = adapter.composeProposition(slots, now)

  // 8. Charge — strictly after isDecidable + compose. Refusal/clarify paths
  //    above are all unreachable from here; nothing before this line spends
  //    user credits.
  const charge = await deps.deductCredits(viewer, LEAGUE_GENERATE_CREDITS)
  if (!charge.ok) return refused('insufficient_credits', locale)

  return {
    status: 'ready',
    round,
    charged_credits: LEAGUE_GENERATE_CREDITS,
    grade_sources: adapter.gradeSources(slots),
  }
}
