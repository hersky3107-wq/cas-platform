'use client'

import type { CardData } from '@/lib/league/card-types'
import { useCardStream } from '@/lib/league/use-card-stream'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
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
 * (see `CardCompliance.tsx`). Mobile-first: the card is a single-column
 * block with no fixed width, meant to sit in a narrow container; desktop
 * layout is whatever wider container the page places it in (no separate
 * desktop variant needed at this size).
 *
 * Owns Layer A (language) end to end: resolves the locale, applies `dir`
 * for RTL locales (Arabic), and renders the visible toggle. Layer B
 * (visibility) is NOT handled here by design — a card that exists on the
 * page has already passed that gate (see `JurisdictionGate`), so this
 * component only ever deals with "how", never "whether", it renders.
 */
export function PredictionCard({ initialData, live = false, devSignalsQuery }: PredictionCardProps) {
  const { data } = useCardStream({ roundId: initialData.round.round_id, initialData, live })
  const { locale, t, dir, setLocale } = useLeagueLocale(devSignalsQuery)

  return (
    <div dir={dir}>
      <div className="flex justify-end pb-1">
        <LanguageToggle locale={locale} onChange={setLocale} label={t.languageToggleLabel} />
      </div>
      <CardCompliance colorBucket={data.round.color_bucket} t={t}>
        {(receipt) => <CardBody data={data} receipt={receipt} t={t} />}
      </CardCompliance>
    </div>
  )
}
