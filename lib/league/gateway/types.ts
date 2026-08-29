import type { PredictionCategory } from '@/lib/prediction/categories'
import type { PublicCategoryId } from '../catalog'
import type { UiHorizon } from '../horizon'
import type { JurisdictionInput } from '../jurisdiction/resolve'

/**
 * AI Prediction League — freeform prompt gateway SHARED TYPES (pure).
 *
 * The shell owns: auth, rate limit, the normalizer JSON schema, the
 * refuse/clarify/ready envelope, and charge ordering (credits deduct strictly
 * AFTER `isDecidable`). ALL judgment lives in per-category `CategoryAdapter`s
 * (12 planned, one per public chip): entity world, required slots, clarifying
 * questions, jurisdiction overlays, refusal taxonomy, the proposition
 * template, the grading-source ladder, and the research packet.
 *
 * REGULATORY INVARIANTS encoded here:
 *  - No freeform user sentence ever reaches the 40 models or the UI: the
 *    proposition is SERVER-COMPOSED by `composeProposition` from validated
 *    structured fields only.
 *  - Refusal is a first-class product outcome (`GatewayResult.refused`),
 *    never an error, and never charged.
 *  - This file must stay pure (no 'server-only', no fetches) so every
 *    adapter and the shell are unit-testable.
 */

export type EntityKind =
  | 'ticker'
  | 'pair'
  | 'index'
  | 'etf'
  | 'team_or_match'
  | 'election'
  | 'award'
  | 'indicator'
  | 'macro_series'

export type PropositionKind =
  | 'binary_close_higher' // price-series family — sides up|down, qualifier = signed percent
  | 'binary_subject_outcome' // a NAMED subject achieves the stated outcome or not (sports / awards / elections) — sides yes|no (a draw is NO, never "A vs B"), qualifier = audience detail (scoreline / margin / gap)
  | 'binary_threshold' // macro / box office / chart entries — sides above|below, qualifier = predicted value

export type RefusalCode =
  // shell-level
  | 'jurisdiction_blocked'
  | 'election_blackout'
  | 'category_unavailable'
  | 'low_confidence'
  | 'ambiguous_entity'
  | 'missing_slot'
  | 'ungradeable'
  | 'insufficient_credits'
  // category-specific (each adapter declares which it emits)
  | 'betting_framing'
  | 'specific_property'
  | 'brokerage_advice'
  | 'politics_window'
  | 'non_public_fixture'
  | 'no_result_source'
  | 'unsupported_entity'
  | 'horizon_incompatible'

/** Structured, validated normalization result. NEVER contains freeform model prose. */
export type NormalizeSlots = {
  category_id: PublicCategoryId
  /** Canonical id (AAPL, BTC/USD, MATCH:…, ELECTION:…) — always from a server-side resolver, never from the model. */
  entity_id: string
  entity_kind: EntityKind
  /** Display name for server templates only. */
  entity_label: string
  /** 1d|1w|1m|3m when relevant; null if event-dated. */
  horizon: UiHorizon | null
  /** ISO date when the horizon or event day is known. */
  resolve_by: string | null
  proposition_kind: PropositionKind
  /** Category-specific extras (answered clarify chips land here too). */
  slots: Record<string, string>
  /** 0..1 from the normalizer (clamped by the shell). */
  confidence: number
}

export type ClarifyingQuestion = {
  /** Which missing field this question fills. */
  slot: string
  /** i18n key for the user-facing question — copy lives in `refusal-copy.ts`. */
  prompt_i18n_key: string
  /** Chip answers when the option set is finite. */
  options?: { id: string; label_i18n_key: string }[]
}

export type Refusal = {
  code: RefusalCode
  /** i18n key — never raw model text. */
  message_i18n_key: string
  /** Optional safe facts the UI may show (entity candidates etc.) — server strings only. */
  safe_facts?: Record<string, string>
}

export type GradeSource =
  | { tier: 1; kind: 'twelve_data' | 'official_api'; endpoint: string }
  | { tier: 2; kind: 'perplexity_sourced'; require_url: true }
  | { tier: 3; kind: 'program_compare'; rule: string }

/**
 * Viewer facts the gateway needs. Structurally compatible with
 * `LeagueViewer` (public-access.ts) but declared here so pure gateway code
 * never imports a 'server-only' module.
 */
export type GatewayViewer = {
  userId: string
  isAdmin: boolean
  jurisdiction: JurisdictionInput
}

/**
 * The server-composed round seed — the ONLY proposition text users and the
 * 40 models ever see. Field-compatible with the orchestrator's object-form
 * `RoundInput` and with `CatalogRankedRoundInput`.
 */
export type ComposedRound = {
  proposition_text: string
  category: PredictionCategory
  instrument: string
  horizon: string
  resolution_rule: string
  resolves_at: string
  item_type: 'ranked'
  cache_key: string
}

export type EntityResolution =
  | { ok: true; entity_id: string; entity_kind: EntityKind; label: string }
  | { ok: false; need: ClarifyingQuestion }
  | { ok: false; refuse: Refusal }

/** Round facts an adapter needs to build its packet (subset of a resolved DB round). */
export type PacketRound = {
  id?: string | null
  proposition_text: string
  category: string
  instrument: string
  horizon: string
  resolution_rule: string
  resolves_at: string
}

/**
 * Side-effect requests emitted DURING packet assembly, at the exact point the
 * pre-adapter orchestrator performed them inline. The shell decides whether
 * to honor them (e.g. anchor_price is only persisted for a newly created
 * round). Category-specific members are expected to accrete here — that is
 * deliberate: the union names them so the shell handles each explicitly.
 */
export type PacketBuildEvent = {
  kind: 'anchor_price'
  price: number
  sessionDate: string | null
}

export type PacketBuildContext = {
  round: PacketRound
  /** Remaining kill-switch budget for the run, USD (research spends from it). */
  costCapUsd: number
  onEvent?: (event: PacketBuildEvent) => void | Promise<void>
}

/**
 * What packet assembly hands back to the orchestrator. Shapes mirror the
 * pre-adapter `GenerateResult` fields byte-for-byte so moving assembly into
 * adapters changed nothing user-visible.
 */
export type CategoryPacket = {
  /** Exact closed-book text the models will see; null when no data at all. */
  injection: string | null
  /** Cache key for the write-once packet audit row. */
  researchCacheKey: string
  /** UNROUNDED research spend — seeds the run's cost accumulator. */
  researchCostUsd: number
  dataPacket: { available: boolean; symbol?: string; latestClose?: number; error?: string }
  research: {
    available: boolean
    cached: boolean
    costUsd: number
    queries: string[]
    tier: string
    tierSignal: string
    error?: string
  }
  relatedCreditsSpent: number
}

/** One category's complete judgment surface. The shell holds no category knowledge. */
export interface CategoryAdapter {
  readonly category_id: PublicCategoryId
  /** Value stored on `prediction_rounds.category`; jurisdiction checks this key. */
  readonly ledger_category: PredictionCategory
  readonly entity_kinds: readonly EntityKind[]

  /** Resolve a freeform mention → canonical entity, or ask / refuse. */
  resolveEntity(raw: string, locale: string): Promise<EntityResolution>

  /** Slots that must be filled before a proposition is decidable. */
  requiredSlots(entity: { entity_id: string; entity_kind: EntityKind }): readonly string[]

  /** Clarifying questions for still-empty required slots (order = ask order). */
  clarifyingQuestions(partial: Partial<NormalizeSlots>): ClarifyingQuestion[]

  /**
   * Category overlay on top of the shell's global jurisdiction matrix
   * (the shell runs `isCategoryAllowed` FIRST; this adds category rules
   * like betting framing or election blackouts).
   */
  jurisdictionGate(viewer: GatewayViewer, now: Date): Refusal | null

  /** Distinct refusal codes this adapter may emit, with their i18n keys. */
  refusalTaxonomy(): ReadonlyArray<{ code: RefusalCode; message_i18n_key: string }>

  /**
   * Compose the ONLY proposition text users and the 40 models ever see.
   * Input = structured fields only; no user substring may appear.
   * Throws if called with undecidable slots (programmer error — the shell
   * gates on `isDecidable` first).
   */
  composeProposition(slots: NormalizeSlots, now?: Date): ComposedRound

  /** How this category grades, with the mandatory 3-tier fallback ladder. */
  gradeSources(slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource]

  /** Can this adapter produce a decidable proposition from these slots? */
  isDecidable(slots: NormalizeSlots): boolean

  /**
   * Rebuild minimal slots from a persisted round — used when the orchestrator
   * re-runs an EXISTING round, where no normalizer output exists. Category
   * judgment (entity kind, proposition kind) must not be guessed by the shell.
   */
  slotsForRound(round: PacketRound): NormalizeSlots

  /** Assemble this category's research packet (numbers first, prose last). */
  buildPacket(slots: NormalizeSlots, ctx: PacketBuildContext): Promise<CategoryPacket>
}

/** The refuse/clarify/ready envelope — a 200-level product response, never an error. */
export type GatewayResult =
  | {
      status: 'ready'
      round: ComposedRound
      charged_credits: number
      grade_sources: readonly [GradeSource, GradeSource, GradeSource]
    }
  | { status: 'clarify'; questions: ClarifyingQuestion[]; partial: Partial<NormalizeSlots> }
  | { status: 'refused'; refusal: Refusal & { message: string } }
