/**
 * Prompt builders for the deep report. Debaters never receive the 40-seat
 * vote aggregate. The chair does.
 */
import type { LeagueLocale } from './i18n/locales'
import { languageLockLine, type DebateSide } from './deep-report-policy'

export function openingUserPrompt(input: {
  locale: LeagueLocale
  proposition: string
  packet: string
  dossier: string
  side: DebateSide
  model: string
}): string {
  return [
    languageLockLine(input.locale),
    `You argue the ${input.side.toUpperCase()} side. Model: ${input.model}.`,
    'Use only the closed-book packet and the evidence dossier. Cite source URLs from the dossier.',
    'Do not mention league ballots or other seats outside this debate.',
    '',
    '[Proposition]',
    input.proposition,
    '',
    '[Closed-book packet]',
    input.packet,
    '',
    '[Evidence dossier]',
    input.dossier,
  ].join('\n')
}

export function rebuttalUserPrompt(input: {
  locale: LeagueLocale
  proposition: string
  packet: string
  dossier: string
  side: DebateSide
  ownOpening: string
  oppositeOpenings: string
}): string {
  return [
    languageLockLine(input.locale),
    `Your side is ${input.side.toUpperCase()}. Rebut the other side, then state your own final position and a probability from 0 to 100.`,
    'Do not mention league ballots or other seats outside this debate.',
    '',
    '[Proposition]',
    input.proposition,
    '',
    '[Closed-book packet]',
    input.packet,
    '',
    '[Evidence dossier]',
    input.dossier,
    '',
    '[Your opening]',
    input.ownOpening,
    '',
    '[Opposite openings]',
    input.oppositeOpenings,
  ].join('\n')
}

export function chairUserPrompt(input: {
  locale: LeagueLocale
  proposition: string
  packet: string
  dossier: string
  openings: string
  rebuttals: string
  fortySeatAggregate: string
  categoryNote: string
}): string {
  return [
    languageLockLine(input.locale),
    'You are the chair. One report, in the viewer language, with these sections:',
    '1. Verdict and probability',
    '2. Key evidence table (claim, source, date, tier)',
    '3. YES vs NO summary',
    '4. Minority report',
    '5. Scenarios',
    '6. What would change this view — concrete triggers and dates',
    '7. Comparison with the 40-AI result (agree or disagree, and why)',
    '8. Sources with links',
    '9. Category disclaimer',
    'Unscored commentary. Not investment advice. Do not invent dates or numbers.',
    '',
    input.categoryNote,
    '',
    '[Proposition]',
    input.proposition,
    '',
    '[Closed-book packet]',
    input.packet,
    '',
    '[Evidence dossier]',
    input.dossier,
    '',
    '[Openings]',
    input.openings,
    '',
    '[Rebuttals]',
    input.rebuttals,
    '',
    '[40-seat aggregate and distribution]',
    input.fortySeatAggregate,
  ].join('\n')
}
