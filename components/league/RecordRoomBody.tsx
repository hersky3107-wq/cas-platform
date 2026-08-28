import type { RecordRoomModelEntry, RecordRoomPage, RecordRoomRoundEntry } from '@/lib/league/record-room-aggregate'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { headerWindow } from '@/lib/league/card-header-copy'
import type { ComplianceReceipt } from './CardCompliance'

/**
 * Record-room content. Free recent summary is always shown; deep filters /
 * pagination / CSV are paid affordances whose price is visible in the CTA.
 */
export function RecordRoomBody({
  data,
  receipt,
  t,
  locale,
  deepCost,
  onPageChange,
  onDeepOpen,
  onExportCsv,
  loading,
  modelId,
  from,
  to,
  onModelIdChange,
  onFromChange,
  onToChange,
}: {
  data: RecordRoomPage
  receipt: ComplianceReceipt
  t: LeagueUiPack
  locale: LeagueLocale
  deepCost: number
  onPageChange: (page: number) => void
  onDeepOpen: () => void
  onExportCsv: () => void
  loading: boolean
  modelId: string
  from: string
  to: string
  onModelIdChange: (value: string) => void
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}) {
  void receipt
  const headline = data.headline

  return (
    <>
      <div className="px-4 pt-4 pb-1">
        <h2 className="text-sm font-semibold text-league-fg">{t.recordRoom.title}</h2>
        <p className="text-[11px] text-league-fg-muted">{t.recordRoom.subtitle}</p>
        <p className="mt-1 text-[11px] text-league-fg-muted">{t.recordRoom.freeNote}</p>
      </div>

      {headline.recentGraded > 0 || headline.latestInstrument ? (
        <div className="mx-4 mb-2 rounded-xl bg-league-accent-soft px-3 py-2">
          {headline.latestInstrument && headline.latestOutcome ? (
            <p className="text-xs font-semibold text-league-fg">
              {t.recordRoom.latestRound(
                headline.latestInstrument,
                headerWindow({
                  instrument: headline.latestInstrument,
                  anchorPrice: headline.latestAnchorPrice,
                  anchorSessionDate: headline.latestAnchorSessionDate,
                  resolutionSessionDate: headline.latestResolutionSessionDate,
                  resolutionPrice: headline.latestResolutionPrice,
                  locale,
                  t,
                })
              )}
            </p>
          ) : null}
          <p className="text-[11px] text-league-fg-muted">
            {t.recordRoom.headlineRecent(headline.recentCorrect, headline.recentGraded)}
          </p>
          <p className="mt-1 text-[10px] leading-snug text-league-fg-muted">{t.headline.correlatedNote}</p>
        </div>
      ) : null}

      {data.rounds.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-league-fg-muted">{t.recordRoom.emptyState}</p>
      ) : (
        <ul>
          {data.rounds.map((round) => (
            <RoundEntry key={round.round_id} entry={round} t={t} locale={locale} />
          ))}
        </ul>
      )}

      {data.deep ? (
        <>
          <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-3">
            <input
              value={modelId}
              onChange={(e) => onModelIdChange(e.target.value)}
              placeholder={t.recordRoom.filterModel}
              className="rounded-lg border border-league-border/40 bg-league-bg-elevated px-2 py-1.5 text-[11px]"
            />
            <input
              type="date"
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
              aria-label={t.recordRoom.filterFrom}
              className="rounded-lg border border-league-border/40 bg-league-bg-elevated px-2 py-1.5 text-[11px]"
            />
            <input
              type="date"
              value={to}
              onChange={(e) => onToChange(e.target.value)}
              aria-label={t.recordRoom.filterTo}
              className="rounded-lg border border-league-border/40 bg-league-bg-elevated px-2 py-1.5 text-[11px]"
            />
          </div>
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => onPageChange(1)}
              className="rounded-full bg-league-bg-elevated px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
            >
              {t.recordRoom.applyFilters}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={onExportCsv}
              className="rounded-full bg-league-bg-elevated px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
            >
              {t.recordRoom.exportCsv}
            </button>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={onPageChange} loading={loading} t={t} />
        </>
      ) : (
        <div className="px-4 py-3">
          <button
            type="button"
            disabled={loading}
            onClick={onDeepOpen}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? t.recordRoom.deepUnlocking : t.recordRoom.deepCta(deepCost)}
          </button>
        </div>
      )}
    </>
  )
}

function RoundEntry({ entry, t, locale }: { entry: RecordRoomRoundEntry; t: LeagueUiPack; locale: LeagueLocale }) {
  // Audit sentence is built from the persisted SESSION dates + prices via the
  // SAME helper the card header uses (`headerWindow`) — never from the date
  // embedded in `actual_outcome` (which carries `anchor_price_at`). This is why
  // the two surfaces can never disagree.
  const auditWindow = headerWindow({
    instrument: entry.instrument,
    anchorPrice: entry.anchorPrice,
    anchorSessionDate: entry.anchorSessionDate,
    resolutionSessionDate: entry.resolutionSessionDate,
    resolutionPrice: entry.resolutionPrice,
    locale,
    t,
  })
  return (
    <li className="border-b border-league-border/40 px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-league-fg">{entry.proposition_text}</p>
          <p className="text-[10px] text-league-fg-muted">
            {entry.instrument} · {formatCategory(entry.category)} · {t.recordRoom.resolvedAtLabel}{' '}
            {formatDate(entry.resolved_at)}
            {entry.item_type ? (
              <>
                {' '}
                · <span className="font-mono">{entry.item_type}</span>
              </>
            ) : null}
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-league-accent-soft px-2 py-1 text-[10px] font-semibold text-league-accent-strong">
          {t.recordRoom.modelsScore(entry.correctCount, entry.gradedCount)}
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-league-fg-muted">{t.headline.correlatedNote}</p>
      {entry.actual_outcome ? (
        <p className="mt-1 text-[11px] text-league-fg-muted">
          {t.recordRoom.outcomeLabel}: {auditWindow}
        </p>
      ) : null}
      {entry.models.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {entry.models.map((model) => (
            <ModelGradeChip key={model.model_id} model={model} t={t} />
          ))}
        </div>
      ) : null}
    </li>
  )
}

const GRADE_STYLE: Record<'correct' | 'incorrect' | 'ungraded', string> = {
  correct: 'bg-emerald-500/10 text-emerald-700',
  incorrect: 'bg-rose-500/10 text-rose-700',
  ungraded: 'bg-slate-400/10 text-slate-500',
}

function ModelGradeChip({ model, t }: { model: RecordRoomModelEntry; t: LeagueUiPack }) {
  const grade = model.is_correct === true ? 'correct' : model.is_correct === false ? 'incorrect' : 'ungraded'
  const label = { correct: t.recordRoom.correct, incorrect: t.recordRoom.incorrect, ungraded: t.recordRoom.ungraded }[grade]
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${GRADE_STYLE[grade]}`} title={`${model.brand}: ${label}`}>
      {model.brand}
    </span>
  )
}

function Pagination({
  page,
  totalPages,
  onChange,
  loading,
  t,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
  loading: boolean
  t: LeagueUiPack
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-league-border/40 px-4 py-2 text-[11px] text-league-fg-muted">
      <button
        type="button"
        disabled={page <= 1 || loading}
        onClick={() => onChange(page - 1)}
        className="rounded-full bg-league-bg-elevated px-2.5 py-1 font-semibold disabled:opacity-40"
      >
        {t.recordRoom.pagination.prev}
      </button>
      <span>{t.recordRoom.pagination.pageOf(page, totalPages)}</span>
      <button
        type="button"
        disabled={page >= totalPages || loading}
        onClick={() => onChange(page + 1)}
        className="rounded-full bg-league-bg-elevated px-2.5 py-1 font-semibold disabled:opacity-40"
      >
        {t.recordRoom.pagination.next}
      </button>
    </div>
  )
}

function formatCategory(category: string): string {
  return category.replace(/_/g, ' ')
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
