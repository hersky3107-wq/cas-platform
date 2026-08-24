'use client'

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { CardModelPrediction } from '@/lib/league/card-types'
import type { VerdictGroupCount, VerdictPayload } from '@/lib/league/verdict-aggregate'
import { FLAG_SRC, type CountryCode } from '@/lib/league/country'
import type { ConsensusSummary } from '@/lib/league/card-types'
import { ConsensusHero } from '@/components/league/ConsensusHero'

/**
 * Final-verdict panel — RAW COUNTS ONLY.
 *
 * Hero order (graded cards):
 *  1. Two-line consensus hero (answer + magnitude, then supporting figures)
 *  2. Post-grading magnitude comparison (directly beneath hero)
 *  3. Hit record ("✓29/40 적중")
 *  4. Direction distribution bar and breakdown sections
 */
export function VerdictPanel({
  verdict,
  models,
  t,
  consensus,
  horizon,
  magnitudeCompare = null,
}: {
  verdict: VerdictPayload
  models: readonly CardModelPrediction[]
  t: LeagueUiPack
  consensus: ConsensusSummary
  horizon: string
  magnitudeCompare?: { predictedPct: number; actualPct: number } | null
}) {
  const { hitRecord, distribution } = verdict
  const graded = hitRecord.graded
  if (graded <= 0) return null

  const brandById = new Map(models.map((m) => [m.model_id, m.brand]))
  const totalDir = distribution.up + distribution.down + distribution.noDirection
  const hasStreaks = Boolean(verdict.streaks && Object.keys(verdict.streaks).length > 0)
  const hasOverconfident = verdict.overconfident.length > 0

  return (
    <div className="mx-2 mb-3 mt-1 rounded-xl border border-league-accent bg-league-accent-soft px-4 py-4 md:mx-3 md:px-5 md:py-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-league-accent-strong">{t.verdict.title}</p>
      {consensus.totalModels > 0 ? (
        <ConsensusHero consensus={consensus} horizon={horizon} t={t} magnitudeCompare={magnitudeCompare} />
      ) : null}
      <p className="mt-2 text-lg font-bold leading-snug text-league-fg md:text-xl">
        {t.verdict.heroHits(hitRecord.hits, hitRecord.graded)}
      </p>
      {hitRecord.ungraded > 0 ? (
        <p className="mt-0.5 text-[11px] text-league-fg-muted">{t.verdict.ungradedNote(hitRecord.ungraded)}</p>
      ) : null}

      {totalDir > 0 ? (
        <DistributionBar
          up={distribution.up}
          down={distribution.down}
          noDirection={distribution.noDirection}
          total={totalDir}
          t={t}
        />
      ) : null}

      <p className="mt-2 text-[11px] leading-snug text-league-fg-muted">{t.headline.correlatedNote}</p>

      <div className="mt-3 space-y-1">
        <VerdictSection id="camp" title={t.verdict.sectionCamp} defaultOpen t={t}>
          <GroupRows
            rows={verdict.byCamp}
            labelOf={(key) => t.verdict.campLabels[key as keyof typeof t.verdict.campLabels] ?? key}
            flagOf={(key) => (key === 'us' ? 'US' : key === 'china' ? 'CN' : 'INT')}
            t={t}
          />
        </VerdictSection>

        <VerdictSection id="tier" title={t.verdict.sectionTier} t={t}>
          <GroupRows
            rows={verdict.byTier}
            labelOf={(key) => t.verdict.tierLabels[key as keyof typeof t.verdict.tierLabels] ?? key}
            t={t}
          />
        </VerdictSection>

        <VerdictSection id="book" title={t.verdict.sectionBook} t={t}>
          <GroupRows
            rows={verdict.byBook}
            labelOf={(key) => t.verdict.bookLabels[key as keyof typeof t.verdict.bookLabels] ?? key}
            t={t}
          />
        </VerdictSection>

        <VerdictSection id="country" title={t.verdict.sectionCountry} accordion t={t}>
          <p className="mb-2 text-[10px] leading-snug text-league-fg-muted">{t.verdict.sectionCountryCaution}</p>
          <GroupRows
            rows={verdict.byCountry}
            labelOf={(key) => t.verdict.countryLabels[key as keyof typeof t.verdict.countryLabels] ?? key}
            flagOf={(key) => (key in FLAG_SRC ? (key as CountryCode) : null)}
            t={t}
          />
        </VerdictSection>

        {hasOverconfident ? (
          <VerdictSection id="overconfident" title={t.verdict.sectionOverconfident} t={t}>
            <ul className="space-y-1">
              {verdict.overconfident.map((row) => {
                const dirGlyph = row.direction === 'up' ? '\u25b2' : row.direction === 'down' ? '\u25bc' : row.direction === 'flat' ? '\u25a0' : ''
                const dirLabel = row.direction ? t.direction.badge[row.direction] : t.direction.noCallBadge
                return (
                  <li
                    key={row.model_id}
                    className="flex items-center justify-between gap-2 text-[12px] text-league-fg"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {row.brand}
                      {dirGlyph ? (
                        <span className="ml-1.5 font-mono text-[11px] text-league-fg-muted">
                          {dirGlyph} {dirLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-league-fg-muted">
                      {row.confidence !== null ? t.verdict.overconfidentLine(row.confidence) : '—'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </VerdictSection>
        ) : null}

        {hasStreaks ? (
          <VerdictSection id="streaks" title={t.verdict.sectionStreaks} t={t}>
            <ul className="space-y-1">
              {Object.entries(verdict.streaks!).map(([modelId, streak]) => (
                <li key={modelId} className="text-[12px] text-league-fg">
                  {t.verdict.streakLine(brandById.get(modelId) ?? modelId, streak)}
                </li>
              ))}
            </ul>
          </VerdictSection>
        ) : null}
      </div>
    </div>
  )
}

function DistributionBar({
  up,
  down,
  noDirection,
  total,
  t,
}: {
  up: number
  down: number
  noDirection: number
  total: number
  t: LeagueUiPack
}) {
  const upPct = (up / total) * 100
  const downPct = (down / total) * 100
  const nonePct = (noDirection / total) * 100
  return (
    <div className="mt-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-league-fg-muted">{t.verdict.distributionHeading}</p>
      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-league-bg-elevated" aria-hidden>
        {up > 0 ? <span className="bg-emerald-500" style={{ width: `${upPct}%` }} /> : null}
        {down > 0 ? <span className="bg-rose-500" style={{ width: `${downPct}%` }} /> : null}
        {noDirection > 0 ? <span className="bg-slate-400" style={{ width: `${nonePct}%` }} /> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums text-league-fg-muted">
        <span className="text-emerald-700">
          {up}▲ <span className="sr-only">{t.verdict.distributionUp}</span>
        </span>
        <span className="text-rose-700">
          {down}▼ <span className="sr-only">{t.verdict.distributionDown}</span>
        </span>
        {noDirection > 0 ? (
          <span className="text-slate-600">
            {noDirection}– <span className="sr-only">{t.verdict.distributionNoDirection}</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}

function GroupRows({
  rows,
  labelOf,
  flagOf,
  t,
}: {
  rows: VerdictGroupCount[]
  labelOf: (key: string) => string
  flagOf?: (key: string) => CountryCode | null
  t: LeagueUiPack
}) {
  if (rows.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const code = flagOf?.(row.key) ?? null
        return (
          <li key={row.key} className="flex items-center justify-between gap-2 text-[12px] text-league-fg">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {code ? (
                // eslint-disable-next-line @next/next/no-img-element -- local static SVG
                <img
                  src={FLAG_SRC[code]}
                  alt=""
                  width={18}
                  height={12}
                  className="h-3 w-[18px] rounded-[2px] object-cover ring-1 ring-inset ring-black/10"
                />
              ) : null}
              <span className="truncate font-medium">{labelOf(row.key)}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {t.verdict.rawCount(row.hits, row.graded)}
              {row.ungraded > 0 ? (
                <span className="ml-1.5 text-[10px] text-league-fg-muted">{t.verdict.ungradedNote(row.ungraded)}</span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const apply = () => setDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return desktop
}

function VerdictSection({
  id,
  title,
  children,
  defaultOpen = false,
  accordion = false,
  t,
}: {
  id: string
  title: string
  children: ReactNode
  defaultOpen?: boolean
  /** When true, stay collapsed-by-default on desktop too (국가별). */
  accordion?: boolean
  t: LeagueUiPack
}) {
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(defaultOpen)
  const collapsible = accordion || !desktop
  const expanded = collapsible ? open : true

  function toggle() {
    if (!collapsible) return
    setOpen((v) => !v)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!collapsible) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  return (
    <section className="rounded-lg border border-league-border/40 bg-league-bg-elevated/60">
      <div
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? expanded : undefined}
        aria-controls={`verdict-section-${id}`}
        onClick={toggle}
        onKeyDown={onKeyDown}
        className={
          collapsible
            ? 'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-league-accent-soft/40 active:bg-league-accent-soft/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-league-accent'
            : 'flex w-full items-center justify-between gap-2 px-3 py-2 text-left'
        }
      >
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-league-fg">{title}</h3>
        {collapsible ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-league-accent-strong">
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            />
            {expanded ? t.verdict.collapseSection : t.verdict.expandSection}
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div id={`verdict-section-${id}`} className="border-t border-league-border/30 px-3 pb-2.5 pt-2">
          {children}
        </div>
      ) : null}
    </section>
  )
}
