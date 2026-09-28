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
import { buildRealEstateRankedRoundInput, horizonForProperty } from './real-estate-compose'
import { decodePropertyInstrument, propositionKindForProperty } from './real-estate-catalog'
import { buildRealEstatePacket, type RealEstatePacketIo } from './real-estate-packet'
import { propertyPickQuestion, resolvePropertyTarget } from './real-estate-target'

/**
 * Regional house-price INDEX adapter.
 * Grades a published index for a reference month. Named complexes, addresses,
 * and brokerage ("지금 살까") are refused. REIT tickers belong on index_etf.
 */

const REFUSALS: readonly RefusalCode[] = [
  'specific_property',
  'brokerage_advice',
  'unsupported_entity',
  'past_event',
  'vague_target',
  'jurisdiction_blocked',
  'low_confidence',
]

const MANUAL: readonly [GradeSource, GradeSource, GradeSource] = [
  { tier: 1, kind: 'perplexity_sourced', require_url: true },
  { tier: 2, kind: 'perplexity_sourced', require_url: true },
  { tier: 3, kind: 'operator_manual', require_url: true },
]

function refuse(code: RefusalCode): Refusal {
  return { code, message_i18n_key: refusalMessageKey(code) }
}

export function createRealEstateAdapter(
  io: RealEstatePacketIo,
  nowFn: () => Date = () => new Date(),
): CategoryAdapter {
  return {
    category_id: 'real_estate',
    ledger_category: 'real_estate',
    entity_kinds: ['index'],
    observation_shape: 'name_match',

    async resolveEntity(raw: string): Promise<EntityResolution> {
      const hit = resolvePropertyTarget(raw, nowFn())
      if (hit.kind === 'specific_property') return { ok: false, refuse: refuse('specific_property') }
      if (hit.kind === 'brokerage_advice') return { ok: false, refuse: refuse('brokerage_advice') }
      if (hit.kind === 'reit') return { ok: false, refuse: refuse('unsupported_entity') }
      if (hit.kind === 'past') return { ok: false, refuse: refuse('past_event') }
      if (hit.kind === 'picks') {
        return { ok: false, need: propertyPickQuestion(hit.options) }
      }
      return {
        ok: true,
        entity_id: hit.entityId,
        entity_kind: 'index',
        label: hit.label,
        skip_confirm: true,
      }
    },

    requiredSlots(entity): readonly string[] {
      return decodePropertyInstrument(entity.entity_id) ? [] : ['entity_id']
    },

    clarifyingQuestions(partial: Partial<NormalizeSlots>): ClarifyingQuestion[] {
      if (partial.entity_id && decodePropertyInstrument(partial.entity_id)) return []
      return [propertyPickQuestion([])]
    },

    jurisdictionGate(_viewer: GatewayViewer, _now: Date): Refusal | null {
      return null
    },

    refusalTaxonomy() {
      return REFUSALS.map((code) => ({ code, message_i18n_key: refusalMessageKey(code) }))
    },

    composeProposition(slots: NormalizeSlots, now: Date = new Date()): ComposedRound {
      const built = buildRealEstateRankedRoundInput(
        slots.entity_id,
        isUiHorizon(slots.horizon) ? slots.horizon : undefined,
        now,
      )
      if (!built) throw new Error('real_estate.composeProposition called with undecidable slots')
      return built
    },

    gradeSources(): readonly [GradeSource, GradeSource, GradeSource] {
      return MANUAL
    },

    isDecidable(slots: NormalizeSlots): boolean {
      return decodePropertyInstrument(slots.entity_id) !== null
    },

    slotsForRound(round: PacketRound): NormalizeSlots {
      const decoded = decodePropertyInstrument(round.instrument)
      const resolves = decoded ? new Date(decoded.resolvesAtMs).toISOString() : round.resolves_at
      return {
        category_id: 'real_estate',
        entity_id: round.instrument,
        entity_kind: 'index',
        entity_label: decoded?.region.nameKo ?? '',
        horizon: isUiHorizon(round.horizon) ? round.horizon : horizonForProperty(resolves, new Date(0)),
        resolve_by: resolves.slice(0, 10),
        proposition_kind: decoded ? propositionKindForProperty(decoded) : 'binary_subject_outcome',
        slots: decoded
          ? { country: decoded.country, region: decoded.regionCode, metric: decoded.metric, refMonth: decoded.refMonth }
          : {},
        confidence: 1,
      }
    },

    async buildPacket(_slots: NormalizeSlots, ctx: PacketBuildContext) {
      return buildRealEstatePacket(ctx, io)
    },
  }
}
