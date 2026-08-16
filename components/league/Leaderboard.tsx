'use client'

import type { LeaderboardData } from '@/lib/league/leaderboard-aggregate'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { CardCompliance } from './CardCompliance'
import { LeaderboardBody } from './LeaderboardBody'
import { LanguageToggle } from './LanguageToggle'

export type LeaderboardProps = {
  data: LeaderboardData
  /** DEV-ONLY: forwarded to `useLeagueLocale`, same escape hatch `PredictionCard` uses. */
  devSignalsQuery?: string
}

/**
 * The public entry point for the league leaderboard. Read-only rankings
 * aggregated server-side from already-resolved predictions (see
 * `lib/league/leaderboard-aggregate.ts`) — this component never recomputes a
 * win rate, it only renders the `LeaderboardData` it's handed.
 *
 * Reuses the exact same compliance wrapper (`CardCompliance` +
 * `DisclaimerFooter`) and Layer A locale machinery as the prediction card,
 * for the same reason: this is AI-model PERFORMANCE content, and the same
 * "never render without the disclaimer" guarantee applies. `colorBucket` is
 * fixed to `'green'` (calm tone) — a leaderboard isn't any one round's risk
 * bucket, so it always renders at the calmest, most neutral tone.
 *
 * Mobile-first: single-column, no fixed width, meant to sit in whatever
 * container the page provides.
 */
export function Leaderboard({ data, devSignalsQuery }: LeaderboardProps) {
  const { locale, t, dir, setLocale } = useLeagueLocale(devSignalsQuery)

  return (
    <div dir={dir}>
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="text-[11px] text-league-fg-muted">{t.leaderboard.asOf(formatAsOf(data.generatedAt))}</p>
        <LanguageToggle locale={locale} onChange={setLocale} label={t.languageToggleLabel} />
      </div>
      <CardCompliance colorBucket="green" t={t}>
        {(receipt) => <LeaderboardBody data={data} receipt={receipt} t={t} />}
      </CardCompliance>
    </div>
  )
}

function formatAsOf(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
