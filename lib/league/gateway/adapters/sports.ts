import { isUiHorizon } from '../../horizon'
import { isRefusedFootballLeagueKey } from '../../sports/api-football-leagues'
import { isSportsInstrumentLeague } from './sports-catalog'
import { detectBettingFraming } from '../betting-framing'
import { refusalMessageKey } from '../refusal-copy'
import { targetRefusalCode } from '../target-resolve'
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
  decodeSportsInstrument,
  encodeSportsInstrument,
  isSoccerLeague,
  subjectTeamOf,
  type SportsFixtureLite,
} from './sports-catalog'
import { resolveSportsTarget } from './sports-target'
import {
  buildSportsRankedRoundInput,
  horizonForKickoff,
} from './sports-compose'
import { buildSportsPacket, type SportsPacketIo } from './sports-packet'

/**
 * SPORTS adapter — binary_subject_outcome, name_match.
 *
 * Freeform is a prediction search, not a browse list. Football uses
 * API-Football (all professional competitions); other sports stay on the
 * Odds-API launch slate. Team-alone offers that club’s upcoming fixtures
 * as picks. Vague input is refused. Betting framing → refuse.
 */

const SPORTS_REFUSALS: readonly RefusalCode[] = [
  'betting_framing',
  'non_public_fixture',
  'vague_target',
  'past_event',
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

function asLaunchSlate(
  rows: Array<{ fixture_id: string; league: string; home: string; away: string; kickoff: string }>,
): SportsFixtureLite[] {
  const out: SportsFixtureLite[] = []
  for (const row of rows) {
    if (!isSportsInstrumentLeague(row.league)) continue
    if (isRefusedFootballLeagueKey(row.league)) continue
    if (!row.fixture_id || !row.home || !row.away || !row.kickoff) continue
    out.push({
      fixture_id: row.fixture_id,
      league: row.league,
      home: row.home,
      away: row.away,
      kickoff: row.kickoff,
    })
  }
  return out
}

function clarifyInstruments(options: Array<{ id: string; label: string }>): EntityResolution {
  return {
    ok: false,
    need: {
      slot: 'entity_id',
      prompt_i18n_key: 'league.gateway.clarify.entity',
      allow_free_input: false,
      options: options.map((o) => ({
        id: o.id,
        label_i18n_key: 'league.gateway.clarify.entity',
        label: o.label,
      })),
    },
  }
}

export function createSportsAdapter(io: SportsPacketIo, nowFn: () => Date = () => new Date()): CategoryAdapter {
  return {
    category_id: 'sports',
    ledger_category: 'sports',
    entity_kinds: ['team_or_match'],
    observation_shape: 'name_match',

    async resolveEntity(raw: string, _locale: string, _viewer?: GatewayViewer): Promise<EntityResolution> {
      if (detectBettingFraming(raw, { category: 'sports' })) {
        return { ok: false, refuse: refuse('betting_framing') }
      }

      const decoded = decodeSportsInstrument(raw.trim())
      if (decoded) {
        return {
          ok: true,
          entity_id: raw.trim(),
          entity_kind: 'team_or_match',
          label: subjectTeamOf(decoded),
          skip_confirm: true,
        }
      }

      const now = nowFn()
      const [oddsRows, footballRows] = await Promise.all([
        io.listUpcomingFixtures(now),
        io.searchFootballFixtures ? io.searchFootballFixtures(raw, now).catch(() => []) : Promise.resolve([]),
      ])
      const slate = asLaunchSlate([...footballRows, ...oddsRows])
      const hit = resolveSportsTarget(raw, slate, now)
      if (hit.kind === 'picks') return clarifyInstruments(hit.options)
      if (hit.kind !== 'ready') return { ok: false, refuse: refuse(targetRefusalCode(hit.kind)) }
      const parts = decodeSportsInstrument(hit.entityId)
      return {
        ok: true,
        entity_id: hit.entityId,
        entity_kind: 'team_or_match',
        label: parts ? subjectTeamOf(parts) : hit.label,
        ...(hit.skipConfirm ? { skip_confirm: true } : {}),
      }
    },

    requiredSlots(entity): readonly string[] {
      return decodeSportsInstrument(entity.entity_id) ? [] : ['entity_id']
    },

    clarifyingQuestions(partial: Partial<NormalizeSlots>): ClarifyingQuestion[] {
      if (partial.entity_id && decodeSportsInstrument(partial.entity_id)) return []
      return [
        {
          slot: 'entity_id',
          prompt_i18n_key: 'league.gateway.clarify.entity',
          allow_free_input: true,
        },
      ]
    },

    jurisdictionGate(_viewer: GatewayViewer, _now: Date): Refusal | null {
      // Betting framing is judged from RAW text (this gate has no sentence).
      return null
    },

    refusalTaxonomy() {
      return SPORTS_REFUSALS.map((code) => ({ code, message_i18n_key: refusalMessageKey(code) }))
    },

    composeProposition(slots: NormalizeSlots, now: Date = new Date()): ComposedRound {
      const parts = decodeSportsInstrument(slots.entity_id)
      if (!parts) {
        throw new Error('sports.composeProposition called with undecidable slots — shell must gate on isDecidable')
      }
      const built = buildSportsRankedRoundInput(
        encodeSportsInstrument(parts),
        isUiHorizon(slots.horizon) ? slots.horizon : undefined,
        now
      )
      if (!built) {
        throw new Error('sports.composeProposition failed to build sports ranked round')
      }
      return built
    },

    gradeSources(slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource] {
      const parts = decodeSportsInstrument(slots.entity_id)
      if (parts && isSoccerLeague(parts.league)) {
        return [
          { tier: 1, kind: 'official_api', endpoint: 'api-football:fixture' },
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
      return decodeSportsInstrument(slots.entity_id) !== null
    },

    slotsForRound(round: PacketRound): NormalizeSlots {
      const decoded = decodeSportsInstrument(round.instrument)
      const kickoffIso = decoded ? new Date(decoded.kickoffMs).toISOString() : round.resolves_at
      return {
        category_id: 'sports',
        entity_id: round.instrument,
        entity_kind: 'team_or_match',
        entity_label: decoded ? subjectTeamOf(decoded) : '',
        horizon: isUiHorizon(round.horizon) ? round.horizon : horizonForKickoff(kickoffIso, new Date(0)),
        resolve_by: kickoffIso.slice(0, 10),
        proposition_kind: 'binary_subject_outcome',
        slots: decoded
          ? {
              subject_side: decoded.side,
              league: decoded.league,
              event_id: decoded.eventId,
              home: decoded.home,
              away: decoded.away,
              kickoff: kickoffIso,
              kickoff_ms: String(decoded.kickoffMs),
            }
          : {},
        confidence: 1,
      }
    },

    async buildPacket(_slots: NormalizeSlots, ctx: PacketBuildContext) {
      return buildSportsPacket(ctx, io)
    },
  }
}
