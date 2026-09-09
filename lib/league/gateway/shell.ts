import { LEAGUE_GENERATE_CREDITS } from '../credits'
import { visibleChipInstrumentIds } from '../catalog'
import type { PublicCategoryId } from '../catalog'
import { leagueGatewayAdmission } from './admission'
import { validateNormalizerOutput, type PromptNormalizer } from './normalizer'
import { MAX_CANDIDATE_CHIPS } from './candidate-search'
import { prefilterRejects } from './prefilter'
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
 * envelope, clarify-round cap (2), and CHARGE ORDERING. It holds zero
 * category knowledge — every judgment call is delegated to the
 * `CategoryAdapter` the chip selects.
 *
 * ORDER OF OPERATIONS (design steps; 1–2 live in the HTTP route):
 *   1. Auth                        → 401 (route: `resolveLeagueViewer`)
 *   2. Rate limit                  → 429 (route: `enforceRateLimit`)
 *   3. Adapter pick                → refused `category_unavailable`
 *   4. Jurisdiction (matrix, then adapter overlay) → refused, no charge
 *   4½. Layer-0 pre-filters (no LLM, no DB)        → refused, no charge
 *   5. NORMALIZE + strict schema validation
 *   6. Entity resolution / open-question search / isDecidable
 *      → clarify (max 2 slot rounds, one question) OR refused, no charge
 *   6½. Confirm is UNCONDITIONAL — the user must approve the
 *      server-composed proposition. Two prior slot-clarifies make this
 *      more necessary, not less. Charge is unreachable without it.
 *   7. composeProposition (server template only)
 *   8. Credits deduct — STRICTLY after confirm + a decidable compose
 *   9. ready → caller runs ensureRound + generatePredictions
 */

export const MAX_CLARIFY_ROUNDS = 2

export type GatewayRequest = {
  viewer: GatewayViewer
  /** The chip the user typed under — authoritative for adapter selection. */
  category_id: PublicCategoryId | string
  raw_text: string
  locale: string
  /**
   * Answers from a previous `clarify` round-trip, keyed by question slot.
   * Chip ids, or a 직접 입력 mention for `entity_id` — still only a lookup key.
   */
  answered_slots?: Record<string, string>
  /** How many clarify answers have already been submitted (0 on first send). */
  clarify_round?: number
}

export type CandidateSearchHit = { id: string; label_i18n_key: string }

export type GatewayDeps = {
  adapterFor(categoryId: string): CategoryAdapter | null
  normalizer: PromptNormalizer
  /**
   * Deducts the league-generate charge. Injected so ordering is testable and
   * so admin-skip stays where it lives today (`deductCreditsBalance`).
   */
  deductCredits(viewer: GatewayViewer, credits: number): Promise<{ ok: boolean }>
  now?: () => Date
  /**
   * Open-question candidate search. Optional so unit tests stay LLM-free.
   * Must refuse (return [] / null) rather than invent names.
   */
  searchCandidates?(args: {
    raw_text: string
    locale: string
    adapter: CategoryAdapter
  }): Promise<CandidateSearchHit[] | null>
}

function catalogChipsFor(categoryId: string): { id: string; label_i18n_key: string }[] {
  return visibleChipInstrumentIds(categoryId).map((id) => ({
    id,
    label_i18n_key: `league.catalog.instruments.${id}`,
  }))
}

function refused(
  code: RefusalCode,
  locale: string,
  safe_facts?: Record<string, string>,
  categoryId?: string,
): GatewayResult {
  const key = refusalMessageKey(code)
  const refusal: Refusal & { message: string } = {
    code,
    message_i18n_key: key,
    message: refusalMessageForKey(key, locale),
    ...(safe_facts ? { safe_facts } : {}),
  }
  const chips =
    (code === 'unsupported_entity' || code === 'prompt_not_available') && categoryId
      ? catalogChipsFor(categoryId)
      : undefined
  return { status: 'refused', refusal, ...(chips && chips.length > 0 ? { catalog_chips: chips } : {}) }
}

function refusedFrom(refusal: Refusal, locale: string, categoryId?: string): GatewayResult {
  const chips =
    (refusal.code === 'unsupported_entity' || refusal.code === 'prompt_not_available') && categoryId
      ? catalogChipsFor(categoryId)
      : undefined
  return {
    status: 'refused',
    refusal: { ...refusal, message: refusalMessageForKey(refusal.message_i18n_key, locale) },
    ...(chips && chips.length > 0 ? { catalog_chips: chips } : {}),
  }
}

function roundsUsed(req: GatewayRequest): number {
  const answered = req.answered_slots ?? {}
  const slotAnswers = Object.keys(answered).filter((k) => k !== 'entity_confirmed')
  return Math.max(req.clarify_round ?? 0, slotAnswers.length)
}

function oneQuestion(question: ClarifyingQuestion): ClarifyingQuestion {
  const options =
    question.slot === 'entity_id' ? question.options?.slice(0, MAX_CANDIDATE_CHIPS) : question.options
  return {
    ...question,
    ...(options ? { options } : {}),
    allow_free_input: question.slot === 'entity_id' ? true : question.allow_free_input,
  }
}

function clarifyOrCap(
  questions: ClarifyingQuestion[],
  partial: Partial<NormalizeSlots>,
  used: number,
  locale: string,
): GatewayResult {
  if (used >= MAX_CLARIFY_ROUNDS) return refused('missing_slot', locale)
  const first = questions[0]
  if (!first) return refused('missing_slot', locale)
  return { status: 'clarify', questions: [oneQuestion(first)], partial }
}

export async function runLeagueGateway(req: GatewayRequest, deps: GatewayDeps): Promise<GatewayResult> {
  const { viewer, locale } = req
  const now = deps.now?.() ?? new Date()
  const used = roundsUsed(req)

  // 3. Adapter pick — an unknown chip and a chip with no adapter yet are the
  //    same product answer: this category is not open for freeform input.
  const adapter = deps.adapterFor(String(req.category_id))
  if (!adapter) return refused('category_unavailable', locale)

  // 4. Admission: category matrix, registered-country, then
  //    promptAllowed(jurisdiction × category). Before prefilter / normalize /
  //    charge. Admin bypasses. Adapter overlay may still add category rules.
  const admission = leagueGatewayAdmission(viewer, adapter.category_id, adapter.ledger_category, now.getTime())
  if (admission) return refused(admission, locale, undefined, adapter.category_id)
  const overlay = adapter.jurisdictionGate(viewer, now)
  if (overlay) return refusedFrom(overlay, locale, adapter.category_id)

  // 4½. Layer-0 pre-filters — zero LLM cost for junk.
  if (prefilterRejects(req.raw_text)) return refused('low_confidence', locale)

  // 5. Normalize + strict schema gate. Malformed output is a refusal, not a 500.
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
  //     clarify chip (or 직접 입력) beats the hint, the hint beats the mention.
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

  const openQuestion =
    mentionCandidates.length === 0 || normalized.slots.open_question === 'true' || normalized.needs_slot === 'entity_id'

  if (!entity && openQuestion && mentionCandidates.length === 0 && deps.searchCandidates) {
    const hits = await deps.searchCandidates({ raw_text: req.raw_text, locale, adapter })
    if (!hits || hits.length === 0) return refused('low_confidence', locale)
    return clarifyOrCap(
      [
        {
          slot: 'entity_id',
          prompt_i18n_key: 'league.gateway.clarify.entity',
          options: hits.map((h) => ({ id: h.id, label_i18n_key: h.label_i18n_key })),
          allow_free_input: true,
        },
      ],
      { horizon: normalized.horizon },
      used,
      locale,
    )
  }

  if (!entity) {
    if (entityAsk) return clarifyOrCap([entityAsk], { horizon: normalized.horizon }, used, locale)
    return refusedFrom(
      entityRefusal ?? { code: 'unsupported_entity', message_i18n_key: refusalMessageKey('unsupported_entity') },
      locale,
      adapter.category_id,
    )
  }

  // 6b. Assemble slots: normalizer fields + clarify answers. Horizon answers
  //     are enum-gated the same way the normalizer's horizon was.
  const answeredHorizon =
    answered.horizon === '1d' || answered.horizon === '1w' || answered.horizon === '1m' || answered.horizon === '3m'
      ? answered.horizon
      : null
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

  // 6c. Decidability — the charge gate. Missing slots become one clarify chip.
  if (!adapter.isDecidable(slots)) {
    const questions = adapter.clarifyingQuestions(slots)
    if (questions.length > 0) return clarifyOrCap(questions, slots, used, locale)
    return refused('missing_slot', locale)
  }

  // 6½. Confirm is unconditional. The 2-round cap is for missing slots
  //     (entity / horizon). Confirm is the regulatory approval of the
  //     server-composed proposition and is never skipped.
  if (slots.slots.entity_confirmed !== 'true') {
    const preview = adapter.composeProposition(slots, now)
    return {
      status: 'clarify',
      questions: [
        oneQuestion({
          slot: 'entity_confirmed',
          prompt_i18n_key: 'league.gateway.clarify.confirm_entity',
          options: [{ id: 'true', label_i18n_key: 'league.gateway.clarify.option.confirm_yes' }],
        }),
      ],
      partial: slots,
      preview_proposition: preview.proposition_text,
    }
  }

  // 7. Server-composed proposition — the only text users/models ever see.
  const round = adapter.composeProposition(slots, now)

  // 8. Charge — strictly after isDecidable + compose.
  const charge = await deps.deductCredits(viewer, LEAGUE_GENERATE_CREDITS)
  if (!charge.ok) return refused('insufficient_credits', locale)

  return {
    status: 'ready',
    round,
    charged_credits: LEAGUE_GENERATE_CREDITS,
    grade_sources: adapter.gradeSources(slots),
  }
}
