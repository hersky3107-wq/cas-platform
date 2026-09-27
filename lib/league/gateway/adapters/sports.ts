import { isUiHorizon } from '../../horizon'
import { isSportsLeagueKey } from '../../sports/types'
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
import {
  decodeSportsInstrument,
  encodeSportsInstrument,
  extractSportsMentions,
  fixtureChipLabel,
  fixtureForBoth,
  fixturesForTeam,
  partsFromFixture,
  sideForTeam,
  SPORTS_RESOLVES_AFTER_KICKOFF_MS,
  subjectTeamOf,
  type SportsFixtureLite,
} from './sports-catalog'
import { formatSportsProposition, horizonForKickoff, sportsResolutionRule } from './sports-compose'
import { buildSportsPacket, type SportsPacketIo } from './sports-packet'

/**
 * SPORTS adapter — binary_subject_outcome, name_match.
 *
 * Freeform resolves onto a concrete upcoming fixture from the Odds API slate
 * (cached). Athlete → club → next fixture. Two named teams → clarify chips
 * for which team is the Yes subject. No slate hit → non_public_fixture.
 * Betting framing (국민체육진흥법) → refuse. Grading parks to operator_manual.
 */

const SPORTS_REFUSALS: readonly RefusalCode[] = [
  'betting_framing',
  'non_public_fixture',
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
    if (!isSportsLeagueKey(row.league)) continue
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

function instrumentChip(fixture: SportsFixtureLite, team: string): { id: string; label: string } {
  const side = sideForTeam(fixture, team) ?? 'home'
  const parts = partsFromFixture(fixture, side)
  return {
    id: encodeSportsInstrument(parts),
    label: fixtureChipLabel(fixture, subjectTeamOf(parts)),
  }
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

export function createSportsAdapter(io: SportsPacketIo): CategoryAdapter {
  return {
    category_id: 'sports',
    ledger_category: 'sports',
    entity_kinds: ['team_or_match'],
    observation_shape: 'name_match',

    async resolveEntity(raw: string, _locale: string, _viewer?: GatewayViewer): Promise<EntityResolution> {
      if (detectBettingFraming(raw)) return { ok: false, refuse: refuse('betting_framing') }

      const decoded = decodeSportsInstrument(raw.trim())
      if (decoded) {
        return { ok: true, entity_id: raw.trim(), entity_kind: 'team_or_match', label: subjectTeamOf(decoded) }
      }

      const slate = asLaunchSlate(await io.listUpcomingFixtures(new Date()))
      const mentions = extractSportsMentions(raw)
      const teams = [...new Set(mentions.map((m) => m.canonical))]

      if (teams.length >= 2) {
        const fixture = fixtureForBoth(slate, teams[0]!, teams[1]!, new Date())
        if (!fixture) {
          return { ok: false, refuse: refuse('non_public_fixture', { teams: `${teams[0]} vs ${teams[1]}` }) }
        }
        return clarifyInstruments([instrumentChip(fixture, teams[0]!), instrumentChip(fixture, teams[1]!)])
      }

      if (teams.length === 1) {
        const team = teams[0]!
        const fixtures = fixturesForTeam(slate, team, new Date())
        if (fixtures.length === 0) {
          return { ok: false, refuse: refuse('non_public_fixture', { team }) }
        }
        if (fixtures.length > 1) {
          return clarifyInstruments(fixtures.slice(0, 3).map((f) => instrumentChip(f, team)))
        }
        const fixture = fixtures[0]!
        const chip = instrumentChip(fixture, team)
        return { ok: true, entity_id: chip.id, entity_kind: 'team_or_match', label: subjectTeamOf(decodeSportsInstrument(chip.id)!) }
      }

      if (slate.length === 0) return { ok: false, refuse: refuse('non_public_fixture') }
      return { ok: false, refuse: refuse('unsupported_entity') }
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
      const instrument = encodeSportsInstrument(parts)
      const kickoffIso = new Date(parts.kickoffMs).toISOString()
      const resolvesAt = new Date(parts.kickoffMs + SPORTS_RESOLVES_AFTER_KICKOFF_MS).toISOString()
      const subject = subjectTeamOf(parts)
      void now
      return {
        proposition_text: formatSportsProposition(parts),
        category: 'sports',
        instrument,
        horizon: horizonForKickoff(kickoffIso, now),
        resolution_rule: sportsResolutionRule(parts),
        resolves_at: resolvesAt,
        item_type: 'ranked',
        cache_key: `sports|${instrument}`,
        proposition_kind: 'binary_subject_outcome',
        subject_label: subject,
        observation_shape: 'name_match',
      }
    },

    gradeSources(_slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource] {
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
