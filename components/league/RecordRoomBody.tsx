import type { RecordRoomModelEntry, RecordRoomPage, RecordRoomRoundEntry } from '@/lib/league/record-room-aggregate'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { ComplianceReceipt } from './CardCompliance'

/**
 * The actual record-room content (title, list of resolved rounds,
 * pagination). Do NOT render this outside `<CardCompliance>` — same
 * `receipt`-gating pattern as `CardBody.tsx` / `LeaderboardBody.tsx`.
 *
 * Read-only, immutable log presentation: no edit affordances anywhere in
 * this tree.
 */
export function RecordRoomBody({
  data,
  receipt,
  t,
  onPageChange,
  loading,
}: {
  data: RecordRoomPage
  receipt: ComplianceReceipt
  t: LeagueUiPack
  onPageChange: (page: number) => void
  loading: boolean
}) {
  void receipt
  return (
    <>
      <div className="px-4 pt-4 pb-1">
        <h2 className="text-sm font-semibold text-league-fg">{t.recordRoom.title}</h2>
        <p className="text-[11px] text-league-fg-muted">{t.recordRoom.subtitle}</p>
      </div>

      {data.rounds.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-league-fg-muted">{t.recordRoom.emptyState}</p>
      ) : (
        <ul>
          {data.rounds.map((round) => (
            <RoundEntry key={round.round_id} entry={round} t={t} />
          ))}
        </ul>
      )}

      <Pagination page={data.page} totalPages={data.totalPages} onChange={onPageChange} loading={loading} t={t} />
    </>
  )
}

function RoundEntry({ entry, t }: { entry: RecordRoomRoundEntry; t: LeagueUiPack }) {
  return (
    <li className="border-b border-league-border/40 px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-league-fg">{entry.proposition_text}</p>
          <p className="text-[10px] text-league-fg-muted">
            {entry.instrument} · {formatCategory(entry.category)} · {t.recordRoom.resolvedAtLabel} {formatDate(entry.resolved_at)}
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-league-accent-soft px-2 py-1 text-[10px] font-semibold text-league-accent-strong">
          {t.recordRoom.modelsScore(entry.correctCount, entry.gradedCount)}
        </span>
      </div>
      {entry.actual_outcome ? (
        <p className="mt-1 text-[11px] text-league-fg-muted">
          {t.recordRoom.outcomeLabel}: {entry.actual_outcome}
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

/** Mirrors `CardHeader.tsx`'s `formatCategory` — category is a technical/data label, not translated chrome. Duplicated (not imported) for the same reason `leaderboard-aggregate.ts` duplicates it. */
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
