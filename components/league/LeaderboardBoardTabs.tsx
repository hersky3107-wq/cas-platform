'use client'

import { useState, type ReactNode } from 'react'
import { BLUFF_MIN_CONFIDENCE, HUMBLE_MAX_CONFIDENCE, LONE_WOLF_MAX_SEATS } from '@/lib/league/boards/compute'
import { rateText, type BoardLabels } from '@/lib/league/boards/display'
import { extraRoleLabels, extraSeatCopy } from '@/lib/league/boards/extra-copy'
import type {
  BoardRate,
  BoardRow,
  BoardSet,
  CategoryRanking,
  ConfidenceRow,
  LoneWolfRow,
  ModelRow,
  StreakRow,
} from '@/lib/league/boards/types'
import { EXTRA_SEAT_IDS } from '@/lib/league/extra/seats'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { BoardTab, LeaderboardBoardCopy } from '@/lib/league/i18n/leaderboard-board-copy'
import type { LeagueLocale } from '@/lib/league/i18n/locales'

export type BoardView = {
  t: LeagueUiPack
  copy: LeaderboardBoardCopy
  labels: BoardLabels
  locale: LeagueLocale
}

type FigureSize = 'sm' | 'md' | 'lg'

const PCT_SIZE: Record<FigureSize, string> = { sm: 'text-[11px]', md: 'text-xs', lg: 'text-xl font-bold' }
const NOTE_SIZE: Record<FigureSize, string> = { sm: 'text-[10px]', md: 'text-[11px]', lg: 'text-sm font-medium' }

/** The only place a board figure is printed: a percentage always carries its n. */
export function RateFigure({
  rate,
  view,
  pooled = false,
  size = 'md',
}: {
  rate: BoardRate
  view: BoardView
  pooled?: boolean
  size?: FigureSize
}) {
  const text = rateText(rate, view.copy, { pooled })
  if (text.kind === 'pct') {
    return (
      <span data-rate="pct" className={`font-semibold tabular-nums text-league-fg ${PCT_SIZE[size]}`}>
        {text.text}
      </span>
    )
  }
  return (
    <span data-rate={text.kind} className={`tabular-nums text-league-fg-muted ${NOTE_SIZE[size]}`}>
      {text.text}
    </span>
  )
}

/** Thin bar with a reference line (coin flip by default). No fill without a percentage. */
export function RateBar({ rate, reference = 50 }: { rate: BoardRate; reference?: number }) {
  return (
    <div className="relative mt-1 h-1 w-full rounded-full bg-league-border/30" aria-hidden="true">
      {rate.pct !== null ? (
        <div className="h-1 rounded-full bg-league-accent" style={{ width: `${Math.min(100, Math.max(0, rate.pct))}%` }} />
      ) : null}
      <div className="absolute -top-0.5 h-2 w-px bg-league-fg-muted/70" style={{ left: `${reference}%` }} />
    </div>
  )
}

export function SectionCard({ title, note, children }: { title: string; note?: string | null; children: ReactNode }) {
  return (
    <section className="mx-4 mb-3 rounded-xl border border-league-border/40 bg-league-bg-elevated p-3">
      <p className="pb-2 text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">{title}</p>
      {children}
      {note ? <p className="pt-2 text-[10px] leading-snug text-league-fg-muted">{note}</p> : null}
    </section>
  )
}

function SubHeading({ children }: { children: ReactNode }) {
  return <p className="pb-1.5 pt-1 text-[11px] font-semibold text-league-fg">{children}</p>
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-league-fg-muted">{children}</p>
}

/** Label, figure and bar per row — groups, buckets and sibling families. */
export function BattleRows<R extends BoardRow>({
  rows,
  label,
  sub,
  view,
  pooled = false,
}: {
  rows: readonly R[]
  label: (row: R) => string
  sub?: (row: R) => string | null
  view: BoardView
  pooled?: boolean
}) {
  if (rows.length === 0) return <Muted>{view.copy.noData}</Muted>
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const subText = sub?.(row)
        return (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0">
                <span className="block truncate font-medium text-league-fg">{label(row)}</span>
                {subText ? <span className="block truncate text-[10px] text-league-fg-muted">{subText}</span> : null}
              </span>
              <span className="shrink-0 text-right">
                <RateFigure rate={row.rate} view={view} pooled={pooled} />
              </span>
            </div>
            <RateBar rate={row.rate} />
          </li>
        )
      })}
    </ul>
  )
}

/** Rank, name, figure and record. A row below the minimum sample has no rank. */
export function RankTable<R extends BoardRow>({
  rows,
  label,
  sub,
  view,
  pooled = false,
}: {
  rows: readonly R[]
  label: (row: R) => string
  sub?: (row: R) => string | null
  view: BoardView
  pooled?: boolean
}) {
  const { t } = view
  if (rows.length === 0) return <Muted>{view.copy.noData}</Muted>
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-league-border/40 text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">
          <th className="py-1.5 pe-2 text-start">{t.leaderboard.columns.rank}</th>
          <th className="py-1.5 text-start">{t.leaderboard.columns.name}</th>
          <th className="py-1.5 text-end">{t.leaderboard.columns.winRate}</th>
          <th className="py-1.5 ps-2 text-end">{t.leaderboard.columns.record}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const subText = sub?.(row)
          return (
            <tr key={row.key} className="border-b border-league-border/20 last:border-b-0">
              <td className="py-2 pe-2 tabular-nums text-league-fg-muted">{row.rank ?? '—'}</td>
              <td className="max-w-[12rem] py-2 font-medium text-league-fg">
                <span className="block truncate">{label(row)}</span>
                {subText ? <span className="block truncate text-[10px] font-normal text-league-fg-muted">{subText}</span> : null}
              </td>
              <td className="py-2 text-end">
                <RateFigure rate={row.rate} view={view} pooled={pooled} />
              </td>
              <td className="whitespace-nowrap py-2 ps-2 text-end tabular-nums text-league-fg-muted">
                {t.winRate.record(row.rate.correct, Math.max(0, row.rate.n - row.rate.correct))}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function modelSub(row: ModelRow, view: BoardView): string | null {
  const extra = extraSeatCopy(view.locale, row.modelId)
  if (extra) return extra.role
  return `${view.labels.company(row.company)} · ${view.labels.tier(row.tier)}`
}

function BattleTab({ boards, view }: { boards: BoardSet; view: BoardView }) {
  const { copy, labels } = view
  const { groups, agreement } = boards
  return (
    <>
      <SectionCard title={copy.battle.camp}>
        <BattleRows rows={groups.camp} label={(row) => labels.camp(row.key)} view={view} pooled />
      </SectionCard>
      <SectionCard title={copy.battle.tier} note={copy.battle.tierNote}>
        <BattleRows rows={groups.tier} label={(row) => labels.tier(row.key)} view={view} pooled />
      </SectionCard>
      <SectionCard title={copy.battle.book}>
        <BattleRows rows={groups.book} label={(row) => labels.book(row.key)} view={view} pooled />
      </SectionCard>
      <SectionCard title={copy.battle.weights}>
        <BattleRows rows={groups.weights} label={(row) => labels.weights(row.key)} view={view} pooled />
      </SectionCard>
      <SectionCard title={copy.battle.agreementTitle}>
        <SubHeading>{copy.battle.share}</SubHeading>
        <BattleRows rows={agreement.byMajorityShare} label={(row) => labels.share(row.key)} view={view} />
        <SubHeading>{copy.battle.confidence}</SubHeading>
        <BattleRows rows={agreement.byConfidence} label={(row) => labels.confidence(row.key)} view={view} />
      </SectionCard>
      <p className="px-4 pb-2 text-[10px] text-league-fg-muted">{copy.battle.pooledNote}</p>
    </>
  )
}

function ModelsTab({ boards, view }: { boards: BoardSet; view: BoardView }) {
  const { copy, labels, t } = view
  return (
    <>
      <SectionCard title={copy.models.official}>
        {boards.models.official.length === 0 ? (
          <Muted>{t.leaderboard.emptyState}</Muted>
        ) : (
          <RankTable
            rows={boards.models.official}
            label={(row) => labels.model(row.modelId)}
            sub={(row) => modelSub(row, view)}
            view={view}
          />
        )}
      </SectionCard>
      <SectionCard title={copy.models.extras}>
        <RankTable
          rows={boards.models.extras}
          label={(row) => labels.model(row.modelId)}
          sub={(row) => modelSub(row, view)}
          view={view}
        />
      </SectionCard>
    </>
  )
}

function MiniRank({ title, rows, view }: { title: string; rows: readonly ModelRow[]; view: BoardView }) {
  return (
    <div>
      <SubHeading>{title}</SubHeading>
      <ol className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-league-fg">
              <span className="pe-1 tabular-nums text-league-fg-muted">{row.rank}</span>
              {view.labels.model(row.modelId)}
            </span>
            <span className="shrink-0">
              <RateFigure rate={row.rate} view={view} size="sm" />
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function FieldCard({ ranking, view }: { ranking: CategoryRanking; view: BoardView }) {
  const { copy, labels } = view
  const [open, setOpen] = useState(false)
  return (
    <SectionCard title={labels.category(ranking.key)}>
      {ranking.ranked === 0 ? (
        <Muted>{copy.fields.noRanked}</Muted>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MiniRank title={copy.fields.top} rows={ranking.top} view={view} />
          {ranking.bottom.length > 0 ? <MiniRank title={copy.fields.bottom} rows={ranking.bottom} view={view} /> : null}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="pt-2 text-[11px] font-semibold text-league-accent-strong"
      >
        {open ? copy.fields.hideAll : `${copy.fields.showAll} (${ranking.all.length})`}
      </button>
      {open ? (
        <div className="pt-1">
          <RankTable rows={ranking.all} label={(row) => labels.model(row.modelId)} view={view} />
        </div>
      ) : null}
    </SectionCard>
  )
}

function FieldsTab({ boards, view }: { boards: BoardSet; view: BoardView }) {
  if (boards.categories.categories.length === 0) {
    return (
      <SectionCard title={view.copy.tabs.fields}>
        <Muted>{view.copy.noData}</Muted>
      </SectionCard>
    )
  }
  return (
    <>
      {boards.categories.categories.map((ranking) => (
        <FieldCard key={ranking.key} ranking={ranking} view={view} />
      ))}
    </>
  )
}

function CompaniesTab({ boards, view }: { boards: BoardSet; view: BoardView }) {
  const { copy, labels } = view
  return (
    <>
      <SectionCard title={copy.companies.totals}>
        <RankTable
          rows={boards.companies.companies}
          label={(row) => labels.company(row.key)}
          sub={(row) => copy.companies.models(row.models)}
          view={view}
          pooled
        />
      </SectionCard>
      <SectionCard title={copy.companies.siblings}>
        {boards.companies.siblings.length === 0 ? <Muted>{copy.noData}</Muted> : null}
        {boards.companies.siblings.map((battle) => (
          <div key={battle.company} className="pb-3 last:pb-0">
            <SubHeading>{labels.company(battle.company)}</SubHeading>
            <BattleRows
              rows={battle.members}
              label={(row) => row.key}
              sub={(row) => (row.modelIds.length > 1 ? row.modelIds.map(labels.model).join(' · ') : null)}
              view={view}
              pooled
            />
          </div>
        ))}
      </SectionCard>
    </>
  )
}

function LensesTab({ boards, view }: { boards: BoardSet; view: BoardView }) {
  const { copy, labels } = view
  return (
    <SectionCard title={copy.lenses.title} note={copy.lenses.note}>
      <RankTable rows={boards.lenses.rows} label={(row) => labels.lens(row.key)} view={view} pooled />
      {boards.lenses.withoutLens > 0 ? (
        <p className="pt-2 text-[10px] text-league-fg-muted">{copy.lenses.withoutLens(boards.lenses.withoutLens)}</p>
      ) : null}
    </SectionCard>
  )
}

function ExtrasHeader({ view }: { view: BoardView }) {
  const roleLabels = extraRoleLabels(view.locale)
  return (
    <SectionCard title={view.copy.tabs.extras}>
      <dl className="space-y-1.5">
        {EXTRA_SEAT_IDS.map((id) => {
          const seat = extraSeatCopy(view.locale, id)
          if (!seat) return null
          return (
            <div key={id} className="text-xs">
              <dt className="font-medium text-league-fg">{seat.name}</dt>
              {roleLabels && seat.role && seat.basis ? (
                <dd className="text-[10px] leading-snug text-league-fg-muted">
                  {roleLabels.role}: {seat.role} · {roleLabels.basis}: {seat.basis}
                </dd>
              ) : null}
            </div>
          )
        })}
      </dl>
    </SectionCard>
  )
}

function ExtrasTab({ boards, view }: { boards: BoardSet; view: BoardView }) {
  const { copy, labels } = view
  const { extras } = boards
  return (
    <>
      <ExtrasHeader view={view} />
      <SectionCard title={copy.extras.pooled} note={copy.extras.pooledNote}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-medium text-league-fg-muted">{copy.extras.extrasLabel}</p>
            <RateFigure rate={extras.pooled.extras} view={view} pooled />
            <RateBar rate={extras.pooled.extras} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-league-fg-muted">{copy.extras.ai40Label}</p>
            <RateFigure rate={extras.pooled.ai40} view={view} pooled />
            <RateBar rate={extras.pooled.ai40} />
          </div>
        </div>
      </SectionCard>
      <SectionCard title={copy.extras.h2h}>
        <ul className="space-y-3">
          {extras.seats.map((seat) => (
            <li key={seat.key}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium text-league-fg">{labels.model(seat.key)}</span>
                <RateFigure rate={seat.own} view={view} />
              </div>
              {seat.rounds === 0 ? null : (
                <>
                  <p className="text-[10px] text-league-fg-muted">{copy.extras.together(seat.rounds)}</p>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <p className="truncate text-[10px] text-league-fg-muted">{labels.model(seat.key)}</p>
                      <RateFigure rate={seat.extra} view={view} size="sm" />
                      <RateBar rate={seat.extra} />
                    </div>
                    <div>
                      <p className="truncate text-[10px] text-league-fg-muted">{copy.ai}</p>
                      <RateFigure rate={seat.ai} view={view} size="sm" />
                      <RateBar rate={seat.ai} />
                    </div>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>
      <SectionCard title={labels.model('crow')}>
        <p className="text-xs font-medium text-league-fg">
          {copy.extras.crowLine(extras.crow.contrarian, extras.crow.contrarianRight)}
        </p>
        <p className="text-[10px] text-league-fg-muted">{copy.extras.crowAnswered(extras.crow.answered)}</p>
      </SectionCard>
      <SectionCard title={copy.extras.replay}>
        {extras.replayCurve.length === 0 ? (
          <Muted>{copy.extras.replayEmpty}</Muted>
        ) : (
          <BattleRows
            rows={extras.replayCurve.map((point) => ({ key: point.month, rate: point.rate, rank: null }))}
            label={(row) => row.key}
            view={view}
          />
        )}
      </SectionCard>
    </>
  )
}

function StreakList({ rows, view }: { rows: readonly StreakRow[]; view: BoardView }) {
  if (rows.length === 0) return <Muted>{view.copy.fame.empty}</Muted>
  return (
    <ol className="space-y-1">
      {rows.map((row) => (
        <li key={row.modelId} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-league-fg">{view.labels.model(row.modelId)}</span>
          <span className="shrink-0 font-semibold tabular-nums text-league-fg">{view.copy.fame.streak(row.length)}</span>
        </li>
      ))}
    </ol>
  )
}

function LoneWolfItem({ row, view }: { row: LoneWolfRow; view: BoardView }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-2 text-start text-xs"
      >
        <span className="truncate text-league-fg">{view.labels.model(row.modelId)}</span>
        <span className="shrink-0 font-semibold tabular-nums text-league-fg">{view.copy.fame.times(row.count)}</span>
      </button>
      {open ? (
        <ul className="space-y-0.5 ps-3 pt-1">
          {row.rounds.map((round) => (
            <li key={round.id} className="text-[10px] leading-snug text-league-fg-muted">
              {round.label} · {view.labels.category(round.category)} · {round.resolvesAt.slice(0, 10)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function ConfidenceList({
  rows,
  line,
  view,
}: {
  rows: readonly ConfidenceRow[]
  line: (hits: number, n: number) => string
  view: BoardView
}) {
  const ranked = rows.filter((row) => row.rank !== null)
  const gated = rows.filter((row) => row.band.pct === null).length
  return (
    <>
      {ranked.length === 0 ? (
        <Muted>{view.copy.fame.empty}</Muted>
      ) : (
        <ol className="space-y-1">
          {ranked.slice(0, 10).map((row) => (
            <li key={row.modelId} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-league-fg">
                <span className="pe-1 tabular-nums text-league-fg-muted">{row.rank}</span>
                {view.labels.model(row.modelId)}
              </span>
              <span className="shrink-0 tabular-nums text-league-fg">{line(row.hits, row.band.n)}</span>
            </li>
          ))}
        </ol>
      )}
      {gated > 0 ? <p className="pt-1.5 text-[10px] text-league-fg-muted">{view.copy.fame.insufficientModels(gated)}</p> : null}
    </>
  )
}

function FameTab({ boards, view }: { boards: BoardSet; view: BoardView }) {
  const { copy } = view
  const { fame } = boards
  return (
    <>
      <SectionCard title={copy.fame.current}>
        <StreakList rows={fame.currentStreaks} view={view} />
      </SectionCard>
      <SectionCard title={copy.fame.longest}>
        <StreakList rows={fame.longestStreaks} view={view} />
      </SectionCard>
      <SectionCard title={copy.fame.loneWolf} note={copy.fame.loneWolfNote(LONE_WOLF_MAX_SEATS)}>
        {fame.loneWolves.length === 0 ? (
          <Muted>{copy.fame.empty}</Muted>
        ) : (
          <ul className="space-y-1.5">
            {fame.loneWolves.map((row) => (
              <LoneWolfItem key={row.modelId} row={row} view={view} />
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title={copy.fame.bluff} note={copy.fame.bluffNote(BLUFF_MIN_CONFIDENCE)}>
        <ConfidenceList rows={fame.bluff} line={copy.fame.bluffLine} view={view} />
      </SectionCard>
      <SectionCard title={copy.fame.humble} note={copy.fame.humbleNote(HUMBLE_MAX_CONFIDENCE)}>
        <ConfidenceList rows={fame.humble} line={copy.fame.humbleLine} view={view} />
      </SectionCard>
    </>
  )
}

export function BoardTabBody({ tab, boards, view }: { tab: BoardTab; boards: BoardSet; view: BoardView }) {
  if (tab === 'models') return <ModelsTab boards={boards} view={view} />
  if (tab === 'fields') return <FieldsTab boards={boards} view={view} />
  if (tab === 'companies') return <CompaniesTab boards={boards} view={view} />
  if (tab === 'lenses') return <LensesTab boards={boards} view={view} />
  if (tab === 'extras') return <ExtrasTab boards={boards} view={view} />
  if (tab === 'fame') return <FameTab boards={boards} view={view} />
  return <BattleTab boards={boards} view={view} />
}
