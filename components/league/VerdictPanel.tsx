import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { CardModelPrediction } from '@/lib/league/card-types'
import type { VerdictGroupCount, VerdictPayload } from '@/lib/league/verdict-aggregate'
import { sideLabelsFor, type SideLabels } from '@/lib/league/side-labels'
import { directionBadgeLabel } from '@/lib/league/compliance'
import { FLAG_SRC, type CountryCode } from '@/lib/league/country'
import type { ConsensusSummary } from '@/lib/league/card-types'
import { BOOK_ACCENT, CAMP_ACCENT, TIER_ACCENT, WEIGHT_ACCENT } from '@/lib/league/breakdown-display'
import { ConsensusHero } from '@/components/league/ConsensusHero'
import { DetailsDisclosure } from './DetailsDisclosure'

/**
 * Final-verdict panel — RAW COUNTS ONLY.
 *
 * Hero order (graded cards):
 *  1. Glanceable direction counts + ratio bar + conclusion
 *  2. Post-grading magnitude comparison (inside the hero)
 *  3. Hit record ("✓29/40 적중") — smaller, never competing with the conclusion
 *  4. Enthusiast hit-breakdowns behind a collapsed "자세히 보기"
 *
 * Every side word/glyph below flows through `labels` (the round's
 * `SideLabels`). Omitting `labels` = the price resolver — same words/glyphs
 * as the pre-resolver panel for up/down rounds.
 */
export function VerdictPanel({
  verdict,
  models,
  t,
  consensus,
  horizon,
  labels,
  magnitudeCompare = null,
}: {
  verdict: VerdictPayload
  models: readonly CardModelPrediction[]
  t: LeagueUiPack
  consensus: ConsensusSummary
  horizon: string
  /** The round's side-label resolver. Omitted only by legacy price-round callers. */
  labels?: SideLabels
  magnitudeCompare?: { predictedPct: number; actualPct: number } | null
}) {
  const { hitRecord } = verdict
  const graded = hitRecord.graded
  if (graded <= 0) return null

  const sl = labels ?? sideLabelsFor({}, t)
  const brandById = new Map(models.map((m) => [m.model_id, m.brand]))
  const hasStreaks = Boolean(verdict.streaks && Object.keys(verdict.streaks).length > 0)
  const hasOverconfident = verdict.overconfident.length > 0

  return (
    <div className="mx-2 mb-3 mt-1 rounded-xl border border-league-accent bg-league-accent-soft px-4 py-4 md:mx-3 md:px-5 md:py-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-league-accent-strong">{t.verdict.title}</p>
      {consensus.totalModels > 0 ? (
        <ConsensusHero consensus={consensus} horizon={horizon} t={t} labels={sl} magnitudeCompare={magnitudeCompare} />
      ) : null}
      <p className="mt-3 text-sm font-semibold leading-snug text-league-fg">
        {t.verdict.heroHits(hitRecord.hits, hitRecord.graded)}
      </p>
      {hitRecord.ungraded > 0 ? (
        <p className="mt-0.5 text-[11px] text-league-fg-muted">{t.verdict.ungradedNote(hitRecord.ungraded)}</p>
      ) : null}

      <p className="mt-2 text-[11px] leading-snug text-league-fg-muted">{t.headline.correlatedNote}</p>

      <DetailsDisclosure t={t}>
        <p className="text-[13px] font-bold tracking-wide text-league-fg md:text-sm">{t.verdict.sectionCamp}</p>
        <GroupRows
          rows={verdict.byCamp}
          labelOf={(key) => t.verdict.campLabels[key as keyof typeof t.verdict.campLabels] ?? key}
          flagOf={(key) => (key === 'us' ? 'US' : key === 'china' ? 'CN' : 'INT')}
          accentOf={(key) => CAMP_ACCENT[key as keyof typeof CAMP_ACCENT] ?? 'bg-slate-400'}
          t={t}
        />

        <p className="mt-4 text-[13px] font-bold tracking-wide text-league-fg md:text-sm">{t.verdict.sectionTier}</p>
        <GroupRows
          rows={verdict.byTier}
          labelOf={(key) => t.verdict.tierLabels[key as keyof typeof t.verdict.tierLabels] ?? key}
          accentOf={(key) => TIER_ACCENT[key as keyof typeof TIER_ACCENT] ?? 'bg-slate-400'}
          t={t}
        />

        <p className="mt-4 text-[13px] font-bold tracking-wide text-league-fg md:text-sm">{t.verdict.sectionBook}</p>
        <GroupRows
          rows={verdict.byBook}
          labelOf={(key) => t.verdict.bookLabels[key as keyof typeof t.verdict.bookLabels] ?? key}
          accentOf={(key) => BOOK_ACCENT[key as keyof typeof BOOK_ACCENT] ?? 'bg-slate-400'}
          t={t}
        />

        <p className="mt-4 text-[13px] font-bold tracking-wide text-league-fg md:text-sm">{t.verdict.sectionWeights}</p>
        <GroupRows
          rows={verdict.byWeights}
          labelOf={(key) => t.verdict.weightLabels[key as keyof typeof t.verdict.weightLabels] ?? key}
          accentOf={(key) => WEIGHT_ACCENT[key as keyof typeof WEIGHT_ACCENT] ?? 'bg-slate-400'}
          t={t}
        />

        <p className="mt-4 text-[13px] font-bold tracking-wide text-league-fg md:text-sm">{t.verdict.sectionCountry}</p>
        <p className="mb-2 text-[12px] leading-snug text-league-fg-muted">{t.verdict.sectionCountryCaution}</p>
        <GroupRows
          rows={verdict.byCountry}
          labelOf={(key) => t.verdict.countryLabels[key as keyof typeof t.verdict.countryLabels] ?? key}
          flagOf={(key) => (key in FLAG_SRC ? (key as CountryCode) : null)}
          t={t}
        />

        {hasOverconfident ? (
          <>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-league-fg-muted">
              {t.verdict.sectionOverconfident}
            </p>
            <ul className="mt-1 space-y-1">
              {verdict.overconfident.map((row) => {
                const dirGlyph = row.direction ? sl.glyph(row.direction) : ''
                const dirLabel = directionBadgeLabel(row.direction, t, sl)
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
          </>
        ) : null}

        {hasStreaks ? (
          <>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-league-fg-muted">
              {t.verdict.sectionStreaks}
            </p>
            <ul className="mt-1 space-y-1">
              {Object.entries(verdict.streaks!).map(([modelId, streak]) => (
                <li key={modelId} className="text-[12px] text-league-fg">
                  {t.verdict.streakLine(brandById.get(modelId) ?? modelId, streak)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </DetailsDisclosure>
    </div>
  )
}

function GroupRows({
  rows,
  labelOf,
  flagOf,
  accentOf,
  t,
}: {
  rows: VerdictGroupCount[]
  labelOf: (key: string) => string
  flagOf?: (key: string) => CountryCode | null
  accentOf?: (key: string) => string
  t: LeagueUiPack
}) {
  if (rows.length === 0) return null
  return (
    <ul className="mt-2 space-y-2">
      {rows.map((row) => {
        const code = flagOf?.(row.key) ?? null
        const accent = accentOf?.(row.key)
        return (
          <li
            key={row.key}
            className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-2 text-[14px] text-league-fg ring-1 ring-league-border/40"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              {accent ? <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${accent}`} aria-hidden /> : null}
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
              <span className="truncate font-semibold">{labelOf(row.key)}</span>
            </span>
            <span className="shrink-0 font-mono text-[14px] font-semibold tabular-nums">
              {t.verdict.rawCount(row.hits, row.graded)}
              {row.ungraded > 0 ? (
                <span className="ml-1.5 text-[12px] font-medium text-league-fg-muted">{t.verdict.ungradedNote(row.ungraded)}</span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
