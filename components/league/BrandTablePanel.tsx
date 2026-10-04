'use client'

import type { BrandTableView, BrandTableViewRow } from '@/lib/league/ai-ranking/brand-table'
import { brandTableCopy } from '@/lib/league/ai-ranking/brand-table-copy'
import type { LeagueLocale } from '@/lib/league/i18n/locales'

function Table({
  title,
  rows,
  showVotes,
  locale,
}: {
  title: string
  rows: readonly BrandTableViewRow[]
  showVotes: boolean
  locale: LeagueLocale
}) {
  const c = brandTableCopy(locale)
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-league-fg">{title}</p>
      <table className="w-full text-left text-[12px]" data-testid="brand-table">
        <thead>
          <tr className="text-[10px] text-league-fg-muted">
            <th className="py-1 pr-2 font-semibold">{c.colRank}</th>
            <th className="py-1 pr-2 font-semibold">{c.colBrand}</th>
            <th className="py-1 pr-2 font-semibold">{c.colModel}</th>
            {showVotes ? <th className="py-1 font-semibold">{c.colVotes}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${title}-${row.rank}-${row.brand}`} className="border-t border-league-border/40">
              <td className="py-1 pr-2 font-mono tabular-nums">{row.rank}</td>
              <td className="py-1 pr-2 font-semibold">{row.brand}</td>
              <td className="py-1 pr-2 text-league-fg-muted">{row.model || '—'}</td>
              {showVotes ? (
                <td className="py-1 font-mono tabular-nums">
                  {row.firstVotes}
                  {row.voteSharePct != null ? ` (${row.voteSharePct}%)` : ''}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function BrandTablePanel({
  view,
  locale,
  graded,
}: {
  view: BrandTableView
  locale: LeagueLocale
  graded: boolean
}) {
  const c = brandTableCopy(locale)
  return (
    <section
      className="mx-2 mb-3 mt-1 rounded-xl border border-league-border bg-league-bg-elevated px-4 py-4 md:mx-3 md:px-5"
      data-testid="brand-table-panel"
    >
      {view.headlineBrand ? (
        <p className="text-[13px] font-semibold leading-snug text-league-fg md:text-sm" data-testid="brand-table-headline">
          {c.headline(view.headlineFirstVotes, view.headlineBrand, view.officialAnswered || 40)}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-4 md:flex-row">
        <Table title={c.predictedTable} rows={view.predicted} showVotes locale={locale} />
        <Table
          title={graded && view.actual ? c.actualTable : c.currentTable}
          rows={graded && view.actual ? view.actual : view.current}
          showVotes={false}
          locale={locale}
        />
      </div>
      {graded && view.actual ? (
        <div className="mt-3 space-y-1 text-[12px] text-league-fg-muted">
          {view.top1Hits != null && view.gradedSeats != null ? (
            <p data-testid="brand-table-top1">{c.top1Hits(view.top1Hits, view.gradedSeats)}</p>
          ) : null}
          {view.seatsBeatBaseline != null && view.gradedSeats != null ? (
            <p data-testid="brand-table-baseline">
              {c.persistence}: {c.persistenceBeat(view.seatsBeatBaseline, view.gradedSeats)}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 text-[10px] text-league-fg-muted">{c.attribution}</p>
    </section>
  )
}
