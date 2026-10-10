'use client'

import { HazardIconRow } from '@/components/crisis/HazardIcon'
import { TriggerChip } from '@/components/crisis/TriggerChip'
import { stageBannerText, type CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import type { CrisisLocale } from '@/lib/crisis/i18n/locales'
import { countryDisplayName } from '@/lib/crisis/i18n/place-names'
import { formatPeopleShort, keyTriggerFact, type TriggerFact } from '@/lib/crisis/public/format'
import { hazardIconsFor } from '@/lib/crisis/ui/hazards'
import { severityTheme } from '@/lib/crisis/ui/severity'

export type DangerRegion = {
  regionId: number
  name: string
  country: string
  iso3?: string | null
  stage: number
  score: number
  triggers: string[]
  fragility: string[]
  peopleNorm: number | null
  peopleCount?: number | null
  urban: Array<{ name: string; pop: number }>
  triggerFacts?: TriggerFact[]
}

function peopleForLine(row: DangerRegion): number | null {
  if (row.peopleCount && row.peopleCount > 0) return row.peopleCount
  const urban = row.urban.reduce((sum, item) => sum + (item.pop || 0), 0)
  return urban > 0 ? urban : null
}

export function dangerLine(row: DangerRegion, t: CrisisUiPack, locale: CrisisLocale): string {
  const fact = keyTriggerFact(row.triggerFacts ?? [])
  let triggerText: string | null = null
  if (fact?.key === 'rain' && fact.sumMm != null) triggerText = t.rainForecastShort(fact.sumMm)
  else if (fact?.key === 'river' && fact.peakM3s != null) triggerText = t.riverPeak(fact.peakM3s)
  else if (fact?.key === 'quake' && fact.mag != null) triggerText = t.quakeMag(fact.mag)
  else if (row.triggers[0]) triggerText = t.triggerLabel(row.triggers[0])
  const fragilityText = row.fragility.length > 0 ? t.dangerFragilityUnit(row.fragility.length) : null
  const people = peopleForLine(row)
  const peopleText = people != null ? t.dangerPeopleUnit(formatPeopleShort(people, locale)) : null
  return [triggerText, fragilityText, peopleText].filter(Boolean).join(' + ')
}

export function DangerNowSection({
  t,
  locale,
  regions,
}: {
  t: CrisisUiPack
  locale: CrisisLocale
  regions: DangerRegion[]
}) {
  const top = [...regions].sort((a, b) => b.score - a.score).slice(0, 5)
  if (top.length === 0) return null

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-black tracking-tight text-white">{t.dangerNowTitle}</h2>
        <p className="text-xs text-slate-500">{t.dangerNowSubtitle}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {top.map((row) => {
          const theme = severityTheme(row.stage)
          const icons = hazardIconsFor(row.triggers)
          return (
            <article
              key={row.regionId}
              className={`rounded-2xl px-4 py-4 ${theme.pulseBorder ? 'crisis-pulse-border' : ''}`}
              style={{ background: theme.bg, border: `1.5px solid ${theme.border}` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-lg px-2 py-0.5 text-[11px] font-black"
                      style={{ background: theme.bannerBg, color: theme.color }}
                    >
                      {stageBannerText(row.stage, t)}
                    </span>
                    <HazardIconRow kinds={icons} color={theme.color} />
                  </div>
                  <h3 className="mt-2 truncate text-lg font-black text-white">
                    {row.name}{' '}
                    <span className="text-sm font-semibold text-slate-400">
                      {countryDisplayName(row.iso3, locale, row.country)}
                    </span>
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {row.triggers.slice(0, 4).map((key) => (
                      <TriggerChip
                        key={key}
                        t={t}
                        triggerKey={key}
                        expectedWindow={row.triggerFacts?.find((fact) => fact.key === key)?.expectedWindow}
                        className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                        style={{ borderColor: `${theme.color}44`, color: theme.color, background: `${theme.color}11` }}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-300">{dangerLine(row, t, locale)}</p>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
