import { LEAGUE_GENERATE_CREDITS } from '../credits'
import { isCatalogInstrumentAllowed, visibleChipInstrumentIdsForViewer } from '../catalog'
import type { PublicCategoryId } from '../catalog'
import { leagueGatewayAdmission } from './admission'
import { validateNormalizerOutput, type PromptNormalizer, type ValidatedNormalizerOutput } from './normalizer'
import { MAX_CANDIDATE_CHIPS } from './candidate-search'
import { detectBettingFraming } from './betting-framing'
import { prefilterRejects } from './prefilter'
import { decodeEntertainmentInstrument, parseAdmissionsThreshold } from './adapters/entertainment-catalog'
import { decodePoliticsInstrument } from './adapters/politics-catalog'
import { decodePropertyInstrument } from './adapters/real-estate-catalog'
import { decodeSportsInstrument } from './adapters/sports-catalog'
import { decodeStockInstrument, parseStockHorizonFromQuery } from './adapters/stock-catalog'
import { propositionKindFor } from './normalize-prompt'
import { MAX_PROPERTY_PICKS } from './adapters/real-estate-target'
import { MAX_TARGET_PICKS } from './target-resolve'
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

/** Categories whose adapter resolves races/fixtures/regions from raw text without the normalizer. */
const SLATE_BACKED_CATEGORIES = new Set<string>([
  'politics_election',
  'sports',
  'entertainment',
  'real_estate',
  'stocks',
  'tech',
])

export function isSlateBackedCategory(id: string): boolean {
  return SLATE_BACKED_CATEGORIES.has(id)
}

function isFreeformInstrument(id: string): boolean {
  return (
    decodeSportsInstrument(id) !== null ||
    decodePoliticsInstrument(id) !== null ||
    decodeEntertainmentInstrument(id) !== null ||
    decodePropertyInstrument(id) !== null ||
    decodeStockInstrument(id) !== null ||
    id.startsWith('AIRANK:')
  )
}

const GATEWAY_DEBUG =
  typeof process !== 'undefined' && (process.env.LEAGUE_GATEWAY_DEBUG === '1' || process.env.LEAGUE_GATEWAY_DEBUG === 'true')

function gwDebug(label: string, payload: Record<string, unknown>): void {
  if (!GATEWAY_DEBUG) return
  console.log(`[league-gateway] ${label}`, JSON.stringify(payload))
}

function entityRefusalIsImmediate(code: RefusalCode): boolean {
  return (
    code === 'betting_framing' ||
    code === 'vague_target' ||
    code === 'past_event' ||
    code === 'vague_election' ||
    code === 'past_election' ||
    code === 'politics_window' ||
    code === 'unsupported_election' ||
    code === 'celebrity_private' ||
    code === 'subjective_show' ||
    code === 'vague_show' ||
    code === 'past_show' ||
    code === 'unsupported_show' ||
    code === 'rumor_only' ||
    code === 'subjective_claim' ||
    code === 'ai_ranking' ||
    code === 'unsupported_field' ||
    code === 'airank_min_horizon' ||
    code === 'deadline_too_far' ||
    code === 'already_resolved' ||
    code === 'price_or_earnings' ||
    code === 'vague_claim' ||
    code === 'no_result_source' ||
    code === 'specific_property' ||
    code === 'brokerage_advice' ||
    code === 'korea_listing' ||
    code === 'non_us_listing'
  )
}

async function normalizeForGateway(
  req: GatewayRequest,
  adapter: CategoryAdapter,
  deps: GatewayDeps,
  locale: string,
  viewer: GatewayViewer,
): Promise<ValidatedNormalizerOutput | null | { earlyRefusal: Refusal }> {
  const rawOutput = await deps.normalizer.normalize({
    raw_text: req.raw_text,
    category_id: adapter.category_id,
    locale,
  })
  const parsed = rawOutput === null ? null : validateNormalizerOutput(rawOutput)
  const categoryMatches = parsed !== null && parsed.category_id === adapter.category_id
  gwDebug('normalizeForGateway:after-llm', {
    raw_text: req.raw_text,
    category_id: adapter.category_id,
    parsed_null: parsed === null,
    category_matches: categoryMatches,
    confidence: parsed?.confidence ?? null,
    entity_mention: parsed?.entity_mention ?? null,
    needs_slot: parsed?.needs_slot ?? null,
    open_question: parsed?.slots?.open_question ?? null,
  })
  if (categoryMatches && parsed.confidence >= 0.55) {
    gwDebug('normalizeForGateway:accept-llm', { path: 'high_confidence_llm' })
    return parsed
  }

  if (SLATE_BACKED_CATEGORIES.has(adapter.category_id)) {
    gwDebug('normalizeForGateway:slate-fallback', { calling_resolveEntity: true })
    const resolution = await adapter.resolveEntity(req.raw_text, locale, viewer)
    const resolutionKind = resolution.ok
      ? 'ready'
      : 'need' in resolution
        ? 'need'
        : 'refuse' in resolution
          ? resolution.refuse.code
          : 'unknown'
    gwDebug('normalizeForGateway:resolveEntity-result', {
      kind: resolutionKind,
      pick_count: 'need' in resolution ? resolution.need.options?.length ?? 0 : 0,
    })
    if (resolution.ok || ('need' in resolution && (resolution.need.options?.length ?? 0) > 0)) {
      return {
        category_id: adapter.category_id as ValidatedNormalizerOutput['category_id'],
        entity_mention: categoryMatches ? parsed!.entity_mention : '',
        entity_id_hint: categoryMatches ? parsed!.entity_id_hint : null,
        horizon: categoryMatches ? parsed!.horizon : null,
        proposition_kind: propositionKindFor(adapter.category_id as ValidatedNormalizerOutput['category_id']),
        slots: categoryMatches ? parsed!.slots : {},
        confidence: 0.75,
        needs_slot: null,
      }
    }
    if ('refuse' in resolution && entityRefusalIsImmediate(resolution.refuse.code)) {
      return { earlyRefusal: resolution.refuse }
    }
  }

  if (!parsed || !categoryMatches) {
    gwDebug('normalizeForGateway:reject', { path: 'null_or_category_mismatch' })
    return null
  }
  if (parsed.confidence < 0.55) {
    gwDebug('normalizeForGateway:reject', { path: 'low_confidence_no_recovery' })
    return null
  }
  return parsed
}

export type GatewayRequest = {
  viewer: GatewayViewer
  /** The chip the user typed under — authoritative for adapter selection. */
  category_id: PublicCategoryId | string
  raw_text: string
  locale: string
  /**
   * Answers from a previous `clarify` round-trip, keyed by question slot.
   * Chip ids, or a 직접 입력 mention for `entity_id` — a lookup key, or a
   * numeric threshold (e.g. 200만) applied to the original question.
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
    viewer: GatewayViewer
  }): Promise<CandidateSearchHit[] | null>
}

function catalogChipsFor(categoryId: string, viewer: GatewayViewer): { id: string; label_i18n_key: string }[] {
  // Stocks no longer has a closed chip catalog. A miss must not offer AAPL/NVDA/TSLA
  // as the whole universe; those names still resolve from the sentence itself.
  if (categoryId === 'stocks') return []
  return visibleChipInstrumentIdsForViewer(categoryId, viewer).map((id) => ({
    id,
    label_i18n_key: `league.catalog.instruments.${id}`,
  }))
}

function filterEntityOptions(
  question: ClarifyingQuestion,
  viewer: GatewayViewer,
): ClarifyingQuestion {
  if (question.slot !== 'entity_id' || !question.options) return question
  const options = question.options.filter(
    (o) => viewer.isAdmin || isCatalogInstrumentAllowed(o.id, viewer.jurisdiction),
  )
  return { ...question, options }
}

function refused(
  code: RefusalCode,
  locale: string,
  safe_facts?: Record<string, string>,
  categoryId?: string,
  viewer?: GatewayViewer,
): GatewayResult {
  const key = refusalMessageKey(code)
  const refusal: Refusal & { message: string } = {
    code,
    message_i18n_key: key,
    message: refusalMessageForKey(key, locale),
    ...(safe_facts ? { safe_facts } : {}),
  }
  const chips =
    (code === 'unsupported_entity' || code === 'prompt_not_available') && categoryId && viewer
      ? catalogChipsFor(categoryId, viewer)
      : undefined
  return { status: 'refused', refusal, ...(chips && chips.length > 0 ? { catalog_chips: chips } : {}) }
}

function refusedFrom(refusal: Refusal, locale: string, categoryId?: string, viewer?: GatewayViewer): GatewayResult {
  const chips =
    (refusal.code === 'unsupported_entity' || refusal.code === 'prompt_not_available') && categoryId && viewer
      ? catalogChipsFor(categoryId, viewer)
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
  const fixturePicks =
    question.slot === 'entity_id' &&
    question.options?.some(
      (o) => isFreeformInstrument(o.id),
    )
  const propertyPicks = fixturePicks && question.options?.some((o) => decodePropertyInstrument(o.id) !== null)
  const cap = propertyPicks ? MAX_PROPERTY_PICKS : fixturePicks ? MAX_TARGET_PICKS : MAX_CANDIDATE_CHIPS
  const options = question.slot === 'entity_id' ? question.options?.slice(0, cap) : question.options
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
  viewer: GatewayViewer,
): GatewayResult {
  if (used >= MAX_CLARIFY_ROUNDS) return refused('missing_slot', locale)
  const first = questions[0] ? filterEntityOptions(questions[0], viewer) : undefined
  if (!first) return refused('missing_slot', locale)
  if (first.slot === 'entity_id' && first.options && first.options.length === 0) {
    return refused('jurisdiction_blocked', locale)
  }
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
  if (admission) return refused(admission, locale, undefined, adapter.category_id, viewer)
  const overlay = adapter.jurisdictionGate(viewer, now)
  if (overlay) return refusedFrom(overlay, locale, adapter.category_id, viewer)

  // 4½. Layer-0 pre-filters — zero LLM cost for junk.
  if (prefilterRejects(req.raw_text)) return refused('low_confidence', locale)
  // Betting framing (국민체육진흥법) is a first-class refusal, not junk.
  // Detected here from RAW text so a stripped entity mention cannot bypass it.
  if (detectBettingFraming(req.raw_text)) return refused('betting_framing', locale)

  // 5. Normalize + strict schema gate. Malformed output is a refusal, not a 500.
  // Slate-backed categories (sports, politics, entertainment, real_estate) may
  // recover from a weak parse via adapter.resolveEntity on the raw sentence.
  const normalizedOrEarly = await normalizeForGateway(req, adapter, deps, locale, viewer)
  if (normalizedOrEarly && 'earlyRefusal' in normalizedOrEarly) {
    return refusedFrom(normalizedOrEarly.earlyRefusal, locale, adapter.category_id, viewer)
  }
  const normalized = normalizedOrEarly
  if (!normalized) return refused('low_confidence', locale)

  const answered = req.answered_slots ?? {}

  // 6a. Entity resolution — server-side resolver only. Priority: an answered
  //     clarify chip, then the full raw sentence (sports dates / opponents),
  //     then the hint, then the mention. Open-question catalog search still
  //     keys off named slots so a typed sentence is not treated as a subject.
  const namedCandidates = uniqueCandidates([
    answered.entity_id,
    normalized.entity_id_hint,
    normalized.entity_mention,
  ])
  const answeredEntity = typeof answered.entity_id === 'string' ? answered.entity_id.trim() : ''
  const answeredIsFixture = answeredEntity.length > 0 && isFreeformInstrument(answeredEntity)
  // 직접 입력 "200만 넘길까" is not a title — resolve it against the original sentence.
  const thresholdOverride =
    answeredEntity && !answeredIsFixture && parseAdmissionsThreshold(answeredEntity) != null
      ? `${req.raw_text} ${answeredEntity}`
      : null
  const mentionCandidates = uniqueCandidates([
    answeredIsFixture ? answeredEntity : null,
    thresholdOverride,
    answered.entity_id,
    req.raw_text,
    normalized.entity_id_hint,
    normalized.entity_mention,
  ])
  let entity: {
    entity_id: string
    entity_kind: NormalizeSlots['entity_kind']
    label: string
    skip_confirm?: boolean
  } | null = null
  let entityAsk: ClarifyingQuestion | null = null
  let entityRefusal: Refusal | null = null
  for (const candidate of mentionCandidates) {
    const resolution = await adapter.resolveEntity(candidate, locale, viewer)
    if (resolution.ok) {
      if (!viewer.isAdmin && !isCatalogInstrumentAllowed(resolution.entity_id, viewer.jurisdiction)) {
        entityRefusal = {
          code: 'jurisdiction_blocked',
          message_i18n_key: refusalMessageKey('jurisdiction_blocked'),
        }
        continue
      }
      entity = {
        entity_id: resolution.entity_id,
        entity_kind: resolution.entity_kind,
        label: resolution.label,
        skip_confirm: resolution.skip_confirm,
      }
      entityAsk = null
      entityRefusal = null
      break
    }
    if ('need' in resolution && !entityAsk) entityAsk = filterEntityOptions(resolution.need, viewer)
    if ('refuse' in resolution) {
      if (entityRefusalIsImmediate(resolution.refuse.code)) {
        return refusedFrom(resolution.refuse, locale, adapter.category_id, viewer)
      }
      if (!entityRefusal) entityRefusal = resolution.refuse
    }
  }

  const openQuestion =
    namedCandidates.length === 0 || normalized.slots.open_question === 'true' || normalized.needs_slot === 'entity_id'

  gwDebug('entity-resolution:summary', {
    raw_text: req.raw_text,
    category_id: adapter.category_id,
    has_entity: entity !== null,
    has_entityAsk: entityAsk !== null,
    entityAsk_options: entityAsk?.options?.length ?? 0,
    openQuestion,
    namedCandidates_len: namedCandidates.length,
    has_searchCandidates: Boolean(deps.searchCandidates),
  })

  // Adapter already chose candidates (e.g. politics office → Kalshi picks). Do not
  // run catalog open-question search first — politics has no catalog instruments yet.
  if (!entity && !entityAsk && openQuestion && namedCandidates.length === 0 && deps.searchCandidates) {
    const hits = await deps.searchCandidates({ raw_text: req.raw_text, locale, adapter, viewer })
    gwDebug('open-question-search', { hit_count: hits?.length ?? 0 })
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
      viewer,
    )
  }

  const parsedStockHorizon =
    adapter.category_id === 'stocks' ? parseStockHorizonFromQuery(req.raw_text) : null

  if (!entity) {
    if (entityAsk) return clarifyOrCap([entityAsk], { horizon: parsedStockHorizon ?? normalized.horizon }, used, locale, viewer)
    return refusedFrom(
      entityRefusal ?? { code: 'unsupported_entity', message_i18n_key: refusalMessageKey('unsupported_entity') },
      locale,
      adapter.category_id,
      viewer,
    )
  }

  // 6b. Assemble slots: normalizer fields + clarify answers. Horizon answers
  //     are enum-gated the same way the normalizer's horizon was. Stock lane
  //     heuristics parse freeform query horizons directly (Flow C).
  const answeredHorizon =
    answered.horizon === '1d' || answered.horizon === '1w' || answered.horizon === '1m' || answered.horizon === '3m'
      ? answered.horizon
      : null
  const effectiveHorizon = answeredHorizon ?? parsedStockHorizon ?? normalized.horizon
  const slots: NormalizeSlots = {
    category_id: adapter.category_id,
    entity_id: entity.entity_id,
    entity_kind: entity.entity_kind,
    entity_label: entity.label,
    horizon: effectiveHorizon,
    resolve_by: null,
    proposition_kind: normalized.proposition_kind,
    slots: { ...normalized.slots, ...answered, locale: locale === 'ko' ? 'ko' : 'en' },
    confidence: normalized.confidence,
  }

  // 6c. Decidability — the charge gate. Missing slots become one clarify chip.
  if (!adapter.isDecidable(slots)) {
    const questions = adapter.clarifyingQuestions(slots)
    if (questions.length > 0) return clarifyOrCap(questions, slots, used, locale, viewer)
    return refused('missing_slot', locale)
  }

  // 6½. Confirm approves the server-composed proposition. A sports fixture
  //     chip already names the MATCH instrument — that click is the choice,
  //     so it opens the round (the client then calls generate). A single
  //     resolved team still stops on "네, 맞아요". Stocks/horizon chips
  //     still confirm.
  const picked = typeof answered.entity_id === 'string' ? answered.entity_id.trim() : ''
  const fixturePick = picked.length > 0 && entity.entity_id === picked && isFreeformInstrument(picked)
  if (slots.slots.entity_confirmed !== 'true' && !fixturePick && !entity.skip_confirm) {
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

function uniqueCandidates(values: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}
