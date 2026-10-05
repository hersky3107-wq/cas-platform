import 'server-only'

import type { OfficialOutcomeResolution } from '@/lib/prediction/grading-core'
import { decodeSportsInstrument, isSoccerLeague } from '../gateway/adapters/sports-catalog'
import { fetchFixtureById, resolveFixtureIdForParts } from './api-football'
import {
  decideFootballMatchGrade,
  formatFootballGradeEvidence,
  propositionWantsRegularTime,
} from './api-football-parse'

const FORTY_EIGHT_H_MS = 48 * 60 * 60 * 1000

export async function gradeFootballMatchInstrument(
  instrument: string,
  proposition = '',
  now = new Date(),
): Promise<OfficialOutcomeResolution | null> {
  const parts = decodeSportsInstrument(instrument)
  if (!parts || !isSoccerLeague(parts.league)) return null
  const kickoffMs = parts.kickoffMs
  const fixtureId = await resolveFixtureIdForParts(parts.eventId, {
    home: parts.home,
    away: parts.away,
    kickoffIso: new Date(kickoffMs).toISOString(),
  }, now)
  const { fixture } = fixtureId != null ? await fetchFixtureById(fixtureId, now) : { fixture: null }
  const decision = decideFootballMatchGrade({
    fixture,
    subjectIsHome: parts.side === 'home',
    scoreChoice: proposition
      ? propositionWantsRegularTime(proposition)
        ? 'regular_time'
        : 'final'
      : 'regular_time',
  })
  if (decision.kind === 'missing') {
    if (now.getTime() - kickoffMs >= FORTY_EIGHT_H_MS) return null
    return { status: 'pending', detail: decision.reason }
  }
  if (decision.kind === 'void') {
    return { status: 'voided', rawOutcome: formatFootballGradeEvidence(decision) }
  }
  const session = new Date(kickoffMs).toISOString().slice(0, 10)
  return {
    status: 'resolved',
    outcome: {
      rawOutcome: formatFootballGradeEvidence(decision),
      actualDirection: decision.kind === 'yes' ? 'up' : 'down',
      anchorPrice: 0,
      anchorPriceAt: new Date().toISOString(),
      resolutionPrice: decision.homeGoals + decision.awayGoals / 100,
      resolutionSessionDate: session,
    },
  }
}
