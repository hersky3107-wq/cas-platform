import { isUiHorizon } from '../../horizon'
import { refusalMessageKey } from '../refusal-copy'
import type {
  CategoryAdapter,
  ClarifyingQuestion,
  ComposedRound,
  EntityResolution,
  GatewayViewer,
  GradeSource,
  NormalizeSlots,
  PacketBuildContext,
  PacketRound,
  Refusal,
  RefusalCode,
} from '../types'
import {
  CLAIM_KIND_LABEL,
  TECH_ARTIFACTS,
  TECH_CLAIM_KINDS,
  TECH_COMPANIES,
  TECH_VENUES,
  ARTIFACT_LABEL,
  VENUE_LABEL,
  companyById,
  decodeTechInstrument,
  encodeTechInstrument,
  isPriceOrEarningsKind,
  isTechArtifact,
  isTechClaimKind,
  isTechVenue,
  objectById,
  objectsFor,
  type TechClaimKind,
} from './tech-catalog'
import {
  fieldsFromCatalog,
  formatTechProposition,
  horizonForResolveDate,
  techResolutionRule,
} from './tech-compose'
import { buildTechPacket, type TechPacketIo } from './tech-packet'
import {
  claimFromOpenInstrument,
  decodeOpenTechInstrument,
  formatOpenTechProposition,
  openTechResolutionRule,
  parseOpenTechPrompt,
} from './tech-resolve'
import {
  AIRANK_LEDGER_CATEGORY,
  airankPropositionText,
  airankResolutionRule,
  airankSubjectLabel,
  decodeAirankInstrument,
  isAirankHorizon,
  isAirankInstrument,
  parseAirankInstrument,
} from '../../ai-ranking/instrument'
import { airankHorizonFromDeadline, isAirankRankingQuestion, parseAirankPrompt } from '../../ai-ranking/resolve'

/**
 * TECH adapter — first binary_subject_outcome CategoryAdapter.
 *
 * Public chip and freeform box are NOT wired. Server-side + tests only.
 * Working grade path today is operator_manual (tier 3). Tiers 1–2 are
 * Perplexity-sourced (require_url); there is no official API for
 * "did Apple announce X".
 */

const TECH_REFUSALS: readonly RefusalCode[] = [
  'vague_claim',
  'rumor_only',
  'subjective_claim',
  'price_or_earnings',
  'unsupported_field',
  'airank_min_horizon',
  'deadline_too_far',
  'already_resolved',
  'missing_slot',
  'ungradeable',
  'jurisdiction_blocked',
  'low_confidence',
]

function refuse(code: RefusalCode, safe_facts?: Record<string, string>): Refusal {
  return { code, message_i18n_key: refusalMessageKey(code), ...(safe_facts ? { safe_facts } : {}) }
}

function extra(slots: NormalizeSlots) {
  return slots.slots
}

function airankLocale(slots: NormalizeSlots): 'ko' | 'en' {
  if (slots.slots.locale === 'ko' || slots.slots.locale === 'en') return slots.slots.locale
  return /[\uAC00-\uD7A3]/.test(slots.entity_label) ? 'ko' : 'en'
}

function claimKindOf(slots: NormalizeSlots): string | null {
  const raw = extra(slots).claim_kind
  return typeof raw === 'string' ? raw : null
}

function techFields(slots: NormalizeSlots) {
  return fieldsFromCatalog({
    companyId: slots.entity_id,
    objectId: extra(slots).object_id ?? '',
    artifact: extra(slots).artifact_id ?? '',
    venue: extra(slots).venue_id ?? '',
    date: slots.resolve_by ?? extra(slots).resolve_by ?? '',
  })
}

function isDecidableSlots(slots: NormalizeSlots): boolean {
  if (isPriceOrEarningsKind(claimKindOf(slots))) return false
  if (!isTechClaimKind(claimKindOf(slots))) return false
  if (!isTechArtifact(extra(slots).artifact_id) || !isTechVenue(extra(slots).venue_id)) return false
  const fields = techFields(slots)
  if (!fields) return false
  if (fields.object.claimKind !== claimKindOf(slots)) return false
  return true
}

export function createTechAdapter(io: TechPacketIo, nowFn: () => Date = () => new Date()): CategoryAdapter {
  return {
    category_id: 'tech',
    ledger_category: 'tech',
    entity_kinds: ['company'],
    observation_shape: 'occurrence',

    async resolveEntity(raw: string, locale: string, _viewer?: GatewayViewer): Promise<EntityResolution> {
      const trimmed = raw.trim()
      if (isAirankInstrument(trimmed) && decodeAirankInstrument(trimmed)) {
        const parts = decodeAirankInstrument(trimmed)!
        return {
          ok: true,
          entity_id: trimmed,
          entity_kind: 'company',
          label: airankSubjectLabel(parts, locale === 'ko' ? 'ko' : 'en'),
          skip_confirm: true,
        }
      }
      if (isAirankRankingQuestion(trimmed)) {
        const parsed = parseAirankPrompt(trimmed, nowFn())
        if (!parsed.ok) return { ok: false, refuse: refuse(parsed.code) }
        return {
          ok: true,
          entity_id: parsed.instrument,
          entity_kind: 'company',
          label: parsed.label,
        }
      }
      const legacy = decodeTechInstrument(trimmed)
      if (legacy) {
        const company = companyById(legacy.companyId)
        return {
          ok: true,
          entity_id: trimmed,
          entity_kind: 'company',
          label: company?.label_en ?? legacy.companyId,
          skip_confirm: true,
        }
      }
      const openExisting = decodeOpenTechInstrument(trimmed)
      if (openExisting) {
        return {
          ok: true,
          entity_id: trimmed,
          entity_kind: 'company',
          label: openExisting.subjectSlug,
          skip_confirm: true,
        }
      }
      const parsed = parseOpenTechPrompt(trimmed, nowFn())
      if (!parsed.ok) return { ok: false, refuse: refuse(parsed.code) }
      return {
        ok: true,
        entity_id: parsed.claim.instrument,
        entity_kind: 'company',
        label: parsed.claim.subjectLabel,
      }
    },

    requiredSlots(entity): readonly string[] {
      if (isAirankInstrument(entity.entity_id) || decodeOpenTechInstrument(entity.entity_id) || decodeTechInstrument(entity.entity_id)) {
        return []
      }
      return ['claim_kind', 'object_id', 'artifact_id', 'venue_id', 'resolve_by']
    },

    clarifyingQuestions(partial: Partial<NormalizeSlots>): ClarifyingQuestion[] {
      if (
        partial.entity_id &&
        (isAirankInstrument(partial.entity_id) ||
          decodeOpenTechInstrument(partial.entity_id) ||
          decodeTechInstrument(partial.entity_id))
      ) {
        return []
      }
      const questions: ClarifyingQuestion[] = []
      if (!partial.entity_id) {
        questions.push({
          slot: 'entity_id',
          prompt_i18n_key: 'league.gateway.clarify.entity',
          options: TECH_COMPANIES.map((c) => ({
            id: c.id,
            label_i18n_key: `league.gateway.tech.company.${c.id}`,
          })),
        })
      }
      const extras = partial.slots ?? {}
      if (!isTechClaimKind(extras.claim_kind)) {
        questions.push({
          slot: 'claim_kind',
          prompt_i18n_key: 'league.gateway.clarify.tech.claim_kind',
          options: TECH_CLAIM_KINDS.map((k) => ({
            id: k,
            label_i18n_key: `league.gateway.tech.claim_kind.${k}`,
          })),
        })
      }
      const kind = isTechClaimKind(extras.claim_kind) ? extras.claim_kind : null
      if (partial.entity_id && !objectById(extras.object_id ?? '')) {
        questions.push({
          slot: 'object_id',
          prompt_i18n_key: 'league.gateway.clarify.tech.object',
          options: objectsFor(partial.entity_id, kind).map((o) => ({
            id: o.id,
            label_i18n_key: `league.gateway.tech.object.${o.id}`,
          })),
        })
      }
      if (!isTechArtifact(extras.artifact_id)) {
        questions.push({
          slot: 'artifact_id',
          prompt_i18n_key: 'league.gateway.clarify.tech.artifact',
          options: TECH_ARTIFACTS.map((a) => ({
            id: a,
            label_i18n_key: `league.gateway.tech.artifact.${a}`,
          })),
        })
      }
      if (!isTechVenue(extras.venue_id)) {
        questions.push({
          slot: 'venue_id',
          prompt_i18n_key: 'league.gateway.clarify.tech.venue',
          options: TECH_VENUES.map((v) => ({
            id: v,
            label_i18n_key: `league.gateway.tech.venue.${v}`,
          })),
        })
      }
      if (!partial.resolve_by && !extras.resolve_by) {
        questions.push({
          slot: 'resolve_by',
          prompt_i18n_key: 'league.gateway.clarify.tech.resolve_by',
        })
      }
      return questions
    },

    jurisdictionGate(_viewer: GatewayViewer, _now: Date): Refusal | null {
      // Global matrix already allows tech everywhere, including CN / UNKNOWN.
      return null
    },

    refusalTaxonomy() {
      return TECH_REFUSALS.map((code) => ({ code, message_i18n_key: refusalMessageKey(code) }))
    },

    composeProposition(slots: NormalizeSlots, now: Date = new Date()): ComposedRound {
      if (isAirankInstrument(slots.entity_id)) {
        const parsed = parseAirankInstrument(slots.entity_id)
        if (!parsed.ok) throw new Error(`tech.composeProposition: ${parsed.reason}`)
        const parts = parsed.parts
        const locale = airankLocale(slots)
        const fromDeadline = airankHorizonFromDeadline(parts.deadlineYmd, now)
        const horizon =
          fromDeadline.ok
            ? fromDeadline.horizon
            : slots.horizon && isAirankHorizon(slots.horizon)
              ? slots.horizon
              : '1m'
        return {
          proposition_text: airankPropositionText(parts, locale),
          category: AIRANK_LEDGER_CATEGORY,
          instrument: slots.entity_id,
          horizon,
          resolution_rule: airankResolutionRule(parts, locale),
          resolves_at: `${parts.deadlineYmd}T23:59:59.999Z`,
          item_type: 'ranked',
          cache_key: `airank|${slots.entity_id}|${horizon}`,
          proposition_kind: 'binary_subject_outcome',
          subject_label: airankSubjectLabel(parts, locale),
          observation_shape: 'occurrence',
        }
      }
      const open = claimFromOpenInstrument(slots.entity_id, slots.entity_label, now)
      if (open) {
        return {
          proposition_text: formatOpenTechProposition(open),
          category: 'tech',
          instrument: open.instrument,
          horizon: open.horizon,
          resolution_rule: openTechResolutionRule(open),
          resolves_at: `${open.deadline}T23:59:59.999Z`,
          item_type: 'ranked',
          cache_key: `tech|${open.instrument}|${open.deadline}`,
          proposition_kind: 'binary_subject_outcome',
          subject_label: open.subjectLabel,
          observation_shape: 'occurrence',
        }
      }
      if (isPriceOrEarningsKind(claimKindOf(slots))) {
        throw new Error('tech.composeProposition: price/earnings claims belong on the stocks chip')
      }
      if (!isDecidableSlots(slots)) {
        throw new Error('tech.composeProposition called with undecidable slots — shell must gate on isDecidable')
      }
      const fields = techFields(slots)!
      // BOUNDARY: catalog claim kinds cannot name a close or an earnings print.
      // The stored sentence is always "publish {artifact} for {object} on {venue}
      // by {date}" — never "close higher" / EPS / revenue.
      const en = formatTechProposition(fields, 'en')
      const horizon = horizonForResolveDate(fields.date, now)
      const instrument = encodeTechInstrument(fields.company.id, fields.object.claimKind, fields.object.id)
      return {
        proposition_text: en,
        category: 'tech',
        instrument,
        horizon,
        resolution_rule: techResolutionRule(fields),
        resolves_at: `${fields.date}T23:59:59.999Z`,
        item_type: 'ranked',
        cache_key: `tech|${instrument}|${fields.date}`,
        proposition_kind: 'binary_subject_outcome',
        subject_label: fields.company.label_en,
        observation_shape: 'occurrence',
      }
    },

    gradeSources(slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource] {
      if (isAirankInstrument(slots.entity_id)) {
        return [
          { tier: 1, kind: 'official_api', endpoint: 'lmarena:leaderboard' },
          { tier: 2, kind: 'perplexity_sourced', require_url: true },
          { tier: 3, kind: 'operator_manual', require_url: true },
        ]
      }
      return [
        { tier: 1, kind: 'perplexity_sourced', require_url: true },
        { tier: 2, kind: 'perplexity_sourced', require_url: true },
        { tier: 3, kind: 'operator_manual', require_url: true },
      ]
    },

    isDecidable(slots: NormalizeSlots): boolean {
      if (isAirankInstrument(slots.entity_id)) return decodeAirankInstrument(slots.entity_id) !== null
      if (decodeOpenTechInstrument(slots.entity_id)) return true
      if (decodeTechInstrument(slots.entity_id)) return true
      return isDecidableSlots(slots)
    },

    slotsForRound(round: PacketRound): NormalizeSlots {
      if (isAirankInstrument(round.instrument)) {
        const parts = decodeAirankInstrument(round.instrument)
        const horizon = isUiHorizon(round.horizon) && isAirankHorizon(round.horizon) ? round.horizon : null
        return {
          category_id: 'ai_models',
          entity_id: round.instrument,
          entity_kind: 'company',
          entity_label: parts?.subject ?? '',
          horizon,
          resolve_by: parts?.deadlineYmd ?? round.resolves_at.slice(0, 10),
          proposition_kind: 'binary_subject_outcome',
          slots: parts
            ? {
                arena: parts.arena,
                category: parts.category,
                kind: parts.kind,
                subject: parts.subject,
                param: parts.param ?? '',
                deadline: parts.deadlineYmd,
              }
            : {},
          confidence: 1,
        }
      }
      const open = decodeOpenTechInstrument(round.instrument)
      if (open) {
        const date = open.deadline
        return {
          category_id: 'tech',
          entity_id: round.instrument,
          entity_kind: 'company',
          entity_label: open.subjectSlug,
          horizon: isUiHorizon(round.horizon) ? round.horizon : horizonForResolveDate(date, new Date(0)),
          resolve_by: date,
          proposition_kind: 'binary_subject_outcome',
          slots: {
            event: open.event,
            object: open.objectSlug,
            verification: open.verification,
            resolve_by: date,
          },
          confidence: 1,
        }
      }
      const decoded = decodeTechInstrument(round.instrument)
      const object = decoded ? objectById(decoded.objectId) : null
      const company = decoded ? companyById(decoded.companyId) : null
      const date = round.resolves_at.slice(0, 10)
      return {
        category_id: 'tech',
        entity_id: decoded?.companyId ?? '',
        entity_kind: 'company',
        entity_label: company?.label_en ?? '',
        horizon: isUiHorizon(round.horizon) ? round.horizon : horizonForResolveDate(date, new Date(0)),
        resolve_by: date || null,
        proposition_kind: 'binary_subject_outcome',
        slots: {
          claim_kind: decoded?.claimKind ?? '',
          object_id: decoded?.objectId ?? '',
          artifact_id: object?.defaultArtifact ?? '',
          venue_id: object?.defaultVenue ?? '',
          resolve_by: date,
        },
        confidence: 1,
      }
    },

    async buildPacket(_slots: NormalizeSlots, ctx: PacketBuildContext) {
      return buildTechPacket(ctx, io)
    },
  }
}

/** Chip labels the tests/report can assert without pulling the UI dictionary. */
export function techCatalogChipLabels(locale: 'en' | 'ko'): {
  claimKinds: Record<TechClaimKind, string>
  artifacts: Record<string, string>
  venues: Record<string, string>
} {
  const claimKinds = Object.fromEntries(
    TECH_CLAIM_KINDS.map((k) => [k, CLAIM_KIND_LABEL[k][locale]]),
  ) as Record<TechClaimKind, string>
  const artifacts = Object.fromEntries(TECH_ARTIFACTS.map((a) => [a, ARTIFACT_LABEL[a][locale]]))
  const venues = Object.fromEntries(TECH_VENUES.map((v) => [v, VENUE_LABEL[v][locale]]))
  return { claimKinds, artifacts, venues }
}
