'use client'

import { HazardIconRow } from '@/components/crisis/HazardIcon'
import { stageBannerText, type CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import type { CrisisLocale } from '@/lib/crisis/i18n/locales'
import { countryDisplayName, regionDisplayName } from '@/lib/crisis/i18n/place-names'
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
  urban: Array<{ name: string; pop: number }>
}

function formatPeopleKo(urban: Array<{ name: string; pop: number }>): string | null {
  const total = urban.reduce((sum, row) => sum + (row.pop || 0), 0)
  if (total >= 100_000_000) return `${(total / 100_000_000).toFixed(1).replace(/\.0$/, '')}억`
  if (total >= 10_000) return `${Math.round(total / 10_000).toLocaleString()}만`
  if (total > 0) return total.toLocaleString()
  return null
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
          const triggerText = row.triggers.slice(0, 3).map((key) => t.triggerLabel(key)).join(' + ') || '—'
          const fragilityText = row.fragility.length > 0 ? t.dangerFragilityUnit(row.fragility.length) : null
          const peopleText = formatPeopleKo(row.urban)
          const parts = [triggerText, fragilityText, peopleText ? t.dangerPeopleUnit(peopleText) : null].filter(Boolean)
          const line = parts.join(' + ')

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
                    {regionDisplayName(row.name, row.iso3, locale, row.country)}{' '}
                    <span className="text-sm font-semibold text-slate-400">
                      {countryDisplayName(row.iso3, locale, row.country)}
                    </span>
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {row.triggers.slice(0, 4).map((key) => (
                      <span
                        key={key}
                        className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                        style={{ borderColor: `${theme.color}44`, color: theme.color, background: `${theme.color}11` }}
                      >
                        {t.triggerLabel(key)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-300">{line}</p>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
