import { isUiHorizon } from '../../horizon'
import { detectBettingFraming } from '../betting-framing'
import { bridgePromptToEnglish } from '../prompt-bridge'
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
import { buildEntertainmentRankedRoundInput, horizonForShow } from './entertainment-compose'
import {
  decodeEntertainmentInstrument,
  propositionKindForShow,
  showChipLabel,
} from './entertainment-catalog'
import { buildEntertainmentPacket, type EntertainmentPacketIo } from './entertainment-packet'
import { resolveEntertainmentTarget } from './entertainment-target'
import type { ShowMetric } from '../../entertainment/slate'

/**
 * ENTERTAINMENT adapter — subjective success becomes an official yes/no.
 * "대박/흥행/1등/상" resolves to box-office, chart, or award metrics.
 * KR box office grades from KOBIS. Everything else is operator_manual.
 * Celebrity private life and pure taste questions are refused.
 */

const ENTERTAINMENT_REFUSALS: readonly RefusalCode[] = [
  'betting_framing',
  'celebrity_private',
  'subjective_show',
  'vague_show',
  'past_show',
  'unsupported_show',
  'no_result_source',
  'ambiguous_entity',
  'missing_slot',
  'ungradeable',
  'jurisdiction_blocked',
  'low_confidence',
]

const PRIVATE = /이혼|마약|열애|고소|사망|불륜|임신|구속|divorce|arrested/i
const SUBJECTIVE = /재밌|재미있|명작|평점\s*좋|걸작|good movie|fun movie/i
const SUCCESS = /대박|흥행|1등|1위|상\s*받|수상|오스카|박스오피스|chart/i
const STREAM = /오징어\s*게임|squid game|넷플릭스\s*1위|netflix/i

function refuse(code: RefusalCode): Refusal {
  return { code, message_i18n_key: refusalMessageKey(code) }
}

function missCode(kind: 'vague' | 'past' | 'unsupported', raw: string): RefusalCode {
  if (PRIVATE.test(raw)) return 'celebrity_private'
  if (STREAM.test(raw)) return 'no_result_source'
  if (SUBJECTIVE.test(raw) && !SUCCESS.test(raw)) return 'subjective_show'
  if (kind === 'past') return 'past_show'
  if (kind === 'unsupported') return 'unsupported_show'
  return 'vague_show'
}

export function createEntertainmentAdapter(
  io: EntertainmentPacketIo,
  nowFn: () => Date = () => new Date(),
): CategoryAdapter {
  return {
    category_id: 'entertainment',
    ledger_category: 'entertainment_awards',
    entity_kinds: ['award'],
    observation_shape: 'name_match',

    async resolveEntity(raw: string, locale = 'en'): Promise<EntityResolution> {
      if (detectBettingFraming(raw, { category: 'entertainment_awards' })) {
        return { ok: false, refuse: refuse('betting_framing') }
      }
      if (PRIVATE.test(raw)) return { ok: false, refuse: refuse('celebrity_private') }
      if (STREAM.test(raw)) return { ok: false, refuse: refuse('no_result_source') }
      if (SUBJECTIVE.test(raw) && !SUCCESS.test(raw)) return { ok: false, refuse: refuse('subjective_show') }

      const now = nowFn()
      const bridged = (await bridgePromptToEnglish(raw, locale)).text
      const decoded = decodeEntertainmentInstrument(bridged)
      if (decoded) {
        if (decoded.resolvesAtMs <= now.getTime() - 6 * 60 * 60 * 1000) {
          return { ok: false, refuse: refuse('past_show') }
        }
        return {
          ok: true,
          entity_id: raw.trim(),
          entity_kind: 'award',
          label: decoded.subject,
          skip_confirm: true,
        }
      }

      const slate = await io.listUpcoming(now)
      const hit = resolveEntertainmentTarget(bridged, slate, now)
      if (hit.kind === 'picks') {
        return {
          ok: false,
          need: {
            slot: 'entity_id',
            prompt_i18n_key: 'league.gateway.clarify.entity',
            allow_free_input: true,
            options: hit.options.map((o) => ({
              id: o.id,
              label_i18n_key: 'league.gateway.clarify.entity',
              label: o.label,
            })),
          },
        }
      }
      if (hit.kind !== 'ready') return { ok: false, refuse: refuse(missCode(hit.kind, raw)) }
      return {
        ok: true,
        entity_id: hit.entityId,
        entity_kind: 'award',
        label: hit.label,
        ...(hit.skipConfirm ? { skip_confirm: true } : {}),
      }
    },

    requiredSlots(entity): readonly string[] {
      return decodeEntertainmentInstrument(entity.entity_id) ? [] : ['entity_id']
    },

    clarifyingQuestions(partial: Partial<NormalizeSlots>): ClarifyingQuestion[] {
      if (partial.entity_id && decodeEntertainmentInstrument(partial.entity_id)) return []
      return [{ slot: 'entity_id', prompt_i18n_key: 'league.gateway.clarify.entity', allow_free_input: true }]
    },

    jurisdictionGate(_viewer: GatewayViewer, _now: Date): Refusal | null {
      return null
    },

    refusalTaxonomy() {
      return ENTERTAINMENT_REFUSALS.map((code) => ({ code, message_i18n_key: refusalMessageKey(code) }))
    },

    composeProposition(slots: NormalizeSlots, now: Date = new Date()): ComposedRound {
      const built = buildEntertainmentRankedRoundInput(
        slots.entity_id,
        isUiHorizon(slots.horizon) ? slots.horizon : undefined,
        now,
      )
      if (!built) throw new Error('entertainment.composeProposition called with undecidable slots')
      return built
    },

    gradeSources(slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource] {
      const parts = decodeEntertainmentInstrument(slots.entity_id)
      if (parts && parts.kind === 'boxoffice' && parts.venue === 'KR') {
        return [
          { tier: 1, kind: 'official_api', endpoint: 'kobis:weekly-weekend' },
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
      return decodeEntertainmentInstrument(slots.entity_id) !== null
    },

    slotsForRound(round: PacketRound): NormalizeSlots {
      const decoded = decodeEntertainmentInstrument(round.instrument)
      const resolves = decoded ? new Date(decoded.resolvesAtMs).toISOString() : round.resolves_at
      return {
        category_id: 'entertainment',
        entity_id: round.instrument,
        entity_kind: 'award',
        entity_label: decoded?.subject ?? '',
        horizon: isUiHorizon(round.horizon) ? round.horizon : horizonForShow(resolves, new Date(0)),
        resolve_by: resolves.slice(0, 10),
        proposition_kind: decoded ? propositionKindForShow(decoded) : 'binary_subject_outcome',
        slots: decoded
          ? { kind: decoded.kind, venue: decoded.venue, event: decoded.event, subject: decoded.subject }
          : {},
        confidence: 1,
      }
    },

    async buildPacket(_slots: NormalizeSlots, ctx: PacketBuildContext) {
      return buildEntertainmentPacket(ctx, io)
    },
  }
}

export function entertainmentOptionLabel(row: ShowMetric): string {
  return showChipLabel(row)
}
