/**
 * AI_MODELS adapter — ledger-only AIRANK engine.
 *
 * Public chip and freeform tech-prompt routing are NOT wired. Packet +
 * official LMArena grading only. Horizons: 1w / 1m / 3m.
 */

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
  AIRANK_LEDGER_CATEGORY,
  airankPropositionText,
  decodeAirankInstrument,
  isAirankHorizon,
  isAirankInstrument,
  parseAirankInstrument,
  validateAirankHorizon,
} from '../../ai-ranking/instrument'
import { buildAirankPacket, type AirankAdapterIo } from './ai-models-packet'

const REFUSALS: readonly RefusalCode[] = [
  'prompt_not_available',
  'ungradeable',
  'horizon_incompatible',
  'already_resolved',
  'missing_slot',
  'jurisdiction_blocked',
]

function refuse(code: RefusalCode, safe_facts?: Record<string, string>): Refusal {
  return { code, message_i18n_key: refusalMessageKey(code), ...(safe_facts ? { safe_facts } : {}) }
}

export function createAiModelsAdapter(io: AirankAdapterIo): CategoryAdapter {
  return {
    category_id: 'ai_models',
    ledger_category: AIRANK_LEDGER_CATEGORY,
    entity_kinds: ['company'],
    observation_shape: 'occurrence',

    async resolveEntity(raw: string): Promise<EntityResolution> {
      if (isAirankInstrument(raw) && decodeAirankInstrument(raw)) {
        const parts = decodeAirankInstrument(raw)!
        return {
          ok: true,
          entity_id: raw,
          entity_kind: 'company',
          label: parts.subject,
          skip_confirm: true,
        }
      }
      return { ok: false, refuse: refuse('prompt_not_available') }
    },

    requiredSlots(entity): readonly string[] {
      if (isAirankInstrument(entity.entity_id)) return []
      return ['resolve_by']
    },

    clarifyingQuestions(_partial: Partial<NormalizeSlots>): ClarifyingQuestion[] {
      return []
    },

    jurisdictionGate(_viewer: GatewayViewer, _now: Date): Refusal | null {
      return null
    },

    refusalTaxonomy() {
      return REFUSALS.map((code) => ({ code, message_i18n_key: refusalMessageKey(code) }))
    },

    composeProposition(slots: NormalizeSlots): ComposedRound {
      const parsed = parseAirankInstrument(slots.entity_id, slots.horizon)
      if (!parsed.ok) throw new Error(`ai_models.composeProposition: ${parsed.reason}`)
      const parts = parsed.parts
      const horizon = slots.horizon && isAirankHorizon(slots.horizon) ? slots.horizon : '1m'
      return {
        proposition_text: airankPropositionText(parts),
        category: AIRANK_LEDGER_CATEGORY,
        instrument: slots.entity_id,
        horizon,
        resolution_rule: `First LMArena snapshot published on or after ${parts.deadlineYmd} (never a snapshot from before the round opened). YES if the queried ranking holds; ties on brand_above are NO.`,
        resolves_at: `${parts.deadlineYmd}T23:59:59.999Z`,
        item_type: 'ranked',
        cache_key: `airank|${slots.entity_id}|${horizon}`,
        proposition_kind: 'binary_subject_outcome',
        subject_label: parts.subject,
        observation_shape: 'occurrence',
      }
    },

    gradeSources(_slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource] {
      return [
        { tier: 1, kind: 'official_api', endpoint: 'lmarena:leaderboard' },
        { tier: 2, kind: 'perplexity_sourced', require_url: true },
        { tier: 3, kind: 'operator_manual', require_url: true },
      ]
    },

    isDecidable(slots: NormalizeSlots): boolean {
      if (validateAirankHorizon(slots.horizon) != null) return false
      return parseAirankInstrument(slots.entity_id, slots.horizon).ok
    },

    slotsForRound(round: PacketRound): NormalizeSlots {
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
    },

    async buildPacket(_slots: NormalizeSlots, ctx: PacketBuildContext) {
      return buildAirankPacket(ctx, io)
    },
  }
}
