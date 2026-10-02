'use client'

import type { LeaderboardData } from '@/lib/league/leaderboard-aggregate'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { useLeagueRequestSignals } from '@/lib/league/use-league-request-signals'
import { admissionStockLane } from '@/lib/league/stock-lane'
import { formatKrTrackRecord } from '@/lib/league/korea-disclosure'
import { KrTrackRecordNotice } from '@/components/league/KrLaneDisclosureBlocks'
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
  const { locale, t, dir, setLocale, showLanguageToggle } = useLeagueLocale(devSignalsQuery)
  const signals = useLeagueRequestSignals(devSignalsQuery)
  const koreaLaneViewer =
    admissionStockLane({
      declaredCountry: signals.declaredCountry,
      ipCountry: signals.ipCountry,
    }) === 'korea'
  const trackRecordText = formatKrTrackRecord({ n: data.roundCoverage.graded })

  return (
    <div dir={dir}>
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="text-[11px] text-league-fg-muted">{t.leaderboard.asOf(formatAsOf(data.generatedAt))}</p>
        {showLanguageToggle ? (
          <LanguageToggle locale={locale} onChange={setLocale} label={t.languageToggleLabel} />
        ) : null}
      </div>
      <CardCompliance colorBucket="green" t={t}>
        {(receipt) => (
          <>
            <LeaderboardBody data={data} receipt={receipt} t={t} />
            {koreaLaneViewer ? <KrTrackRecordNotice text={trackRecordText} /> : null}
          </>
        )}
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
