'use client'

import Link from 'next/link'
import { admissionStockLane } from '@/lib/league/stock-lane'
import { doorPath, type HubDoor } from '@/lib/league/hub-doors'
import { leagueSurfaceCopy } from '@/lib/league/i18n/surface-copy'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { useLeagueRequestSignals } from '@/lib/league/use-league-request-signals'

export type HubDoorsProps = { omitMemecoin?: boolean }

export function HubDoors(props: HubDoorsProps = {}) {
  const omitMemecoin = props.omitMemecoin
  const { locale, dir } = useLeagueLocale()
  const signals = useLeagueRequestSignals()
  const koreaLane = admissionStockLane({
    declaredCountry: signals.declaredCountry,
    ipCountry: signals.ipCountry,
  }) === 'korea'
  const hideMemecoin = omitMemecoin ?? koreaLane
  const copy = leagueSurfaceCopy(locale).doors
  const financeItems =
    hideMemecoin && copy.financeItemsNoMemecoin ? copy.financeItemsNoMemecoin : copy.financeItems
  const financeBody =
    hideMemecoin && copy.financeBodyNoMemecoin ? copy.financeBodyNoMemecoin : copy.financeBody

  return (
    <div dir={dir} className="league-landing" data-testid="league-landing">
      <DoorPanel
        door="finance"
        title={copy.financeTitle}
        body={financeBody}
        items={financeItems}
        enter={copy.enter}
      />
      <DoorPanel
        door="world"
        title={copy.worldTitle}
        body={copy.worldBody}
        items={copy.worldItems}
        enter={copy.enter}
      />
    </div>
  )
}

function DoorPanel({
  door,
  title,
  body,
  items,
  enter,
}: {
  door: HubDoor
  title: string
  body: string
  items: string
  enter: string
}) {
  return (
    <article data-testid={`door-${door}`} className="league-door">
      <div className="flex min-h-0 flex-1 flex-col">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">{title}</h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600 md:text-lg">{body}</p>
        <p className="mt-6 text-sm font-medium leading-relaxed text-slate-800 md:text-base">{items}</p>
      </div>
      <Link href={doorPath(door)} className="league-btn-primary mt-8 w-full text-center md:w-auto">
        {enter}
      </Link>
    </article>
  )
}
