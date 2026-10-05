import { isUiHorizon } from '../../horizon'
import { groupForCountry } from '../../jurisdiction/country-groups'
import { raceBlackoutActive } from '../../politics/kr-calendar'
import { detectBettingFraming } from '../betting-framing'
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
import { buildPoliticsRankedRoundInput, horizonForPollClose } from './politics-compose'
import {
  decodePoliticsInstrument,
  instrumentForCandidate,
  politicsChipLabel,
  type PoliticsInstrumentParts,
} from './politics-catalog'
import { buildPoliticsPacket, type PoliticsPacketIo } from './politics-packet'
import { resolvePoliticsTarget } from './politics-target'

/**
 * POLITICS adapter — binary_subject_outcome.
 * Search → resolve → pick on the prediction-market slate (≤ 3 months).
 * KR users cannot open a KR race during that race's D-6 window.
 * US/global races stay open. Grading is operator_manual.
 */

const POLITICS_REFUSALS: readonly RefusalCode[] = [
  'betting_framing',
  'vague_election',
  'past_election',
  'unsupported_election',
  'politics_window',
  'ambiguous_entity',
  'unsupported_entity',
  'missing_slot',
  'ungradeable',
  'jurisdiction_blocked',
  'low_confidence',
]

function refuse(code: RefusalCode, safe_facts?: Record<string, string>): Refusal {
  return { code, message_i18n_key: refusalMessageKey(code), ...(safe_facts ? { safe_facts } : {}) }
}

function viewerTouchesKr(viewer: GatewayViewer | undefined): boolean {
  if (!viewer) return false
  const declared = viewer.jurisdiction.declaredCountry?.trim()
  const ip = viewer.jurisdiction.ipCountry?.trim()
  if (declared && groupForCountry(declared) === 'KR') return true
  if (ip && groupForCountry(ip) === 'KR') return true
  return false
}

function krBlocked(parts: PoliticsInstrumentParts, viewer: GatewayViewer | undefined, now: Date): boolean {
  if (parts.jurisdiction !== 'KR') return false
  if (!viewerTouchesKr(viewer)) return false
  return raceBlackoutActive(new Date(parts.pollCloseMs).toISOString(), now.getTime())
}

function politicsMiss(kind: 'vague' | 'past' | 'unsupported'): RefusalCode {
  if (kind === 'vague') return 'vague_election'
  if (kind === 'past') return 'past_election'
  return 'unsupported_election'
}

export function createPoliticsAdapter(io: PoliticsPacketIo, nowFn: () => Date = () => new Date()): CategoryAdapter {
  return {
    category_id: 'politics_election',
    ledger_category: 'politics_election',
    entity_kinds: ['election'],
    observation_shape: 'name_match',

    async resolveEntity(raw: string, _locale: string, viewer?: GatewayViewer): Promise<EntityResolution> {
      if (detectBettingFraming(raw, { category: 'politics_election' })) {
        return { ok: false, refuse: refuse('betting_framing') }
      }
      const now = nowFn()

      const decoded = decodePoliticsInstrument(raw.trim())
      if (decoded) {
        if (krBlocked(decoded, viewer, now)) return { ok: false, refuse: refuse('politics_window') }
        const close = decoded.pollCloseMs
        if (close <= now.getTime() - 6 * 60 * 60 * 1000) return { ok: false, refuse: refuse('past_election') }
        return {
          ok: true,
          entity_id: raw.trim(),
          entity_kind: 'election',
          label: decoded.candidate,
          skip_confirm: true,
        }
      }

      const slate = await io.listUpcoming(now)
      const hit = resolvePoliticsTarget(raw, slate, now)
      if (process.env.LEAGUE_GATEWAY_DEBUG === '1' || process.env.LEAGUE_GATEWAY_DEBUG === 'true') {
        console.log(
          '[league-gateway] politics.resolveEntity',
          JSON.stringify({
            raw: raw.slice(0, 120),
            slate_size: slate.length,
            ga_governor: slate.filter((r) => r.office === 'governor' && r.district === 'GA').length,
            target_kind: hit.kind,
            pick_count: hit.kind === 'picks' ? hit.options.length : 0,
          }),
        )
      }
      if (hit.kind === 'picks') {
        const open = hit.options.filter((opt) => {
          const parts = decodePoliticsInstrument(opt.id)
          return parts ? !krBlocked(parts, viewer, now) : false
        })
        if (open.length === 0) return { ok: false, refuse: refuse('politics_window') }
        if (open.length === 1) {
          const parts = decodePoliticsInstrument(open[0]!.id)
          return {
            ok: true,
            entity_id: open[0]!.id,
            entity_kind: 'election',
            label: parts?.candidate ?? open[0]!.label,
            skip_confirm: true,
          }
        }
        return {
          ok: false,
          need: {
            slot: 'entity_id',
            prompt_i18n_key: 'league.gateway.clarify.entity',
            allow_free_input: false,
            options: open.map((o) => ({
              id: o.id,
              label_i18n_key: 'league.gateway.clarify.entity',
              label: o.label,
            })),
          },
        }
      }
      if (hit.kind !== 'ready') return { ok: false, refuse: refuse(politicsMiss(hit.kind)) }
      const parts = decodePoliticsInstrument(hit.entityId)
      if (parts && krBlocked(parts, viewer, now)) return { ok: false, refuse: refuse('politics_window') }
      return {
        ok: true,
        entity_id: hit.entityId,
        entity_kind: 'election',
        label: parts?.candidate ?? hit.label,
        ...(hit.skipConfirm ? { skip_confirm: true } : {}),
      }
    },

    requiredSlots(entity): readonly string[] {
      return decodePoliticsInstrument(entity.entity_id) ? [] : ['entity_id']
    },

    clarifyingQuestions(partial: Partial<NormalizeSlots>): ClarifyingQuestion[] {
      if (partial.entity_id && decodePoliticsInstrument(partial.entity_id)) return []
      return [{ slot: 'entity_id', prompt_i18n_key: 'league.gateway.clarify.entity', allow_free_input: true }]
    },

    jurisdictionGate(_viewer: GatewayViewer, _now: Date): Refusal | null {
      return null
    },

    refusalTaxonomy() {
      return POLITICS_REFUSALS.map((code) => ({ code, message_i18n_key: refusalMessageKey(code) }))
    },

    composeProposition(slots: NormalizeSlots, now: Date = new Date()): ComposedRound {
      const built = buildPoliticsRankedRoundInput(
        slots.entity_id,
        isUiHorizon(slots.horizon) ? slots.horizon : undefined,
        now,
      )
      if (!built) throw new Error('politics.composeProposition called with undecidable slots')
      return built
    },

    gradeSources(_slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource] {
      return [
        { tier: 1, kind: 'perplexity_sourced', require_url: true },
        { tier: 2, kind: 'perplexity_sourced', require_url: true },
        { tier: 3, kind: 'operator_manual', require_url: true },
      ]
    },

    isDecidable(slots: NormalizeSlots): boolean {
      return decodePoliticsInstrument(slots.entity_id) !== null
    },

    slotsForRound(round: PacketRound): NormalizeSlots {
      const decoded = decodePoliticsInstrument(round.instrument)
      const pollIso = decoded ? new Date(decoded.pollCloseMs).toISOString() : round.resolves_at
      return {
        category_id: 'politics_election',
        entity_id: round.instrument,
        entity_kind: 'election',
        entity_label: decoded?.candidate ?? '',
        horizon: isUiHorizon(round.horizon) ? round.horizon : horizonForPollClose(pollIso, new Date(0)),
        resolve_by: pollIso.slice(0, 10),
        proposition_kind: 'binary_subject_outcome',
        slots: decoded
          ? {
              jurisdiction: decoded.jurisdiction,
              office: decoded.office,
              cycle: decoded.cycle,
              district: decoded.district,
              candidate: decoded.candidate,
            }
          : {},
        confidence: 1,
      }
    },

    async buildPacket(_slots: NormalizeSlots, ctx: PacketBuildContext) {
      return buildPoliticsPacket(ctx, io, nowFn())
    },
  }
}

export function politicsOptionLabel(row: Parameters<typeof politicsChipLabel>[0]): string {
  return politicsChipLabel(row)
}

export function politicsInstrumentId(row: Parameters<typeof instrumentForCandidate>[0]): string | null {
  return instrumentForCandidate(row)
}
