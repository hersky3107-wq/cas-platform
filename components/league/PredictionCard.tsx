'use client'

import type { CardData } from '@/lib/league/card-types'
import { useCardStream, type CardStreamStartError } from '@/lib/league/use-card-stream'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { CardCompliance } from './CardCompliance'
import { CardBody } from './CardBody'
import { LanguageToggle } from './LanguageToggle'

export type PredictionCardProps = {
  initialData: CardData
  /** Opt into the live stream for an in-progress round. Omit for a resolved/static round (default). */
  live?: boolean
  /** DEV-ONLY: forwarded to `useLeagueLocale` to simulate signals a local request can't produce (see `use-league-request-signals.ts`). Never used outside the admin preview page. */
  devSignalsQuery?: string
}

/**
 * The public entry point for a league prediction card. This is the ONLY
 * exported way to render one — it always composes `CardCompliance` around
 * `CardBody`, so the disclaimer and approved phrasing rules always apply
 * (see `CardCompliance.tsx`). Mobile-first: the board is a single column
 * of collapsible divisions at 375px and a full-width multi-column grid
 * from `md` up — one component, CSS breakpoints, no desktop fork.
 *
 * Owns Layer A (language) end to end: resolves the locale, applies `dir`
 * for RTL locales (Arabic), and renders the visible toggle. Layer B
 * (visibility) is NOT handled here by design — a card that exists on the
 * page has already passed that gate (see `JurisdictionGate`), so this
 * component only ever deals with "how", never "whether", it renders.
 */
export function PredictionCard({ initialData, live = false, devSignalsQuery }: PredictionCardProps) {
  const { data, connection, liveProgress, startError } = useCardStream({
    roundId: initialData.round.round_id,
    initialData,
    live,
  })
  const { locale, t, dir, setLocale } = useLeagueLocale(devSignalsQuery)

  return (
    <div dir={dir}>
      <div className="flex items-center justify-between gap-2 pb-1">
        <LiveStatusPill connection={connection} liveProgress={liveProgress} />
        <LanguageToggle locale={locale} onChange={setLocale} label={t.languageToggleLabel} />
      </div>
      {startError ? (
        <p className="mb-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {liveStartMessage(startError, t)}
        </p>
      ) : null}
      <CardCompliance colorBucket={data.round.color_bucket} t={t} category={data.round.category}>
        {(receipt) => <CardBody data={data} receipt={receipt} t={t} />}
      </CardCompliance>
    </div>
  )
}

/**
 * A live run that was REFUSED never spent a credit and never ran a model — the
 * user is owed the actual reason, localized, not the generic connection error.
 * The stored card below is untouched and still valid, which is why this is a
 * notice above the card rather than a replacement for it.
 */
function liveStartMessage(error: CardStreamStartError, t: LeagueUiPack): string {
  if (error.status === 402) return t.hub.insufficientCredits(error.required ?? 0, error.balance ?? 0)
  if (error.status === 429) return t.hub.rateLimited
  if (error.status === 403) return t.gating.unavailable
  return t.hub.genericError
}

/**
 * Lightweight, mobile-cheap live-arrival indicator (no spinners). Admin/dev
 * surface only for now (live generation is admin-gated), so this is plain
 * English rather than routed through the Layer A `LeagueUiPack` — it is
 * operational status about the STREAM, not card chrome/compliance copy.
 * Renders nothing once back to 'static' (the normal, default state).
 */
function LiveStatusPill({
  connection,
  liveProgress,
}: {
  connection: 'static' | 'connecting' | 'live' | 'reconnecting' | 'error'
  liveProgress: { answered: number; rosterSize: number } | null
}) {
  if (connection === 'static') return null

  const label =
    connection === 'connecting'
      ? 'Connecting…'
      : connection === 'live'
        ? liveProgress
          ? `Live · ${liveProgress.answered}/${liveProgress.rosterSize} answered`
          : 'Live'
        : connection === 'reconnecting'
          ? 'Reconnecting…'
          : 'Connection lost — reloading from server…'

  const dotClass = connection === 'error' ? 'bg-red-500' : connection === 'live' ? 'bg-emerald-500' : 'bg-amber-400'

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-league-bg-elevated px-2.5 py-1 text-[11px] font-medium text-league-fg-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass} ${connection === 'live' ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )
}
