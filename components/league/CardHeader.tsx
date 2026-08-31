import type { CardRoundMeta, HitRateSummary } from '@/lib/league/card-types'
import { cardStatusCopy, cardStatusKind } from '@/lib/league/card-status'
import {
  formatInstrumentPrice,
  formatRoundOpenedDate,
  headerHeadline,
  headerWindow,
} from '@/lib/league/card-header-copy'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import type { ToneTokens } from '@/lib/league/tone'

/**
 * Header: the ROUND's opened date + instrument + ANCHOR (or "unavailable"),
 * a one-line prediction window, and ONE status badge. The date is
 * `opened_at`, never `now()` — an archived card must not read as today's.
 * Live price is secondary and is never shown until an anchor exists.
 */
export function CardHeader({
  round,
  hitRate,
  tone,
  t,
  locale,
  gradingStalled = false,
}: {
  round: CardRoundMeta
  hitRate: HitRateSummary
  tone: ToneTokens
  t: LeagueUiPack
  locale: LeagueLocale
  gradingStalled?: boolean
}) {
  void tone
  const roundDate = formatRoundOpenedDate(round.opened_at, locale)
  const headline = headerHeadline({
    roundDate,
    instrument: round.instrument,
    anchorPrice: round.anchorPrice,
    anchorSessionDate: round.anchorSessionDate,
    propositionKind: round.proposition_kind,
    locale,
    t,
  })
  // '' for non-price contracts (no session closes to audit) — line is skipped.
  const window = headerWindow({
    instrument: round.instrument,
    anchorPrice: round.anchorPrice,
    anchorSessionDate: round.anchorSessionDate,
    resolutionSessionDate: round.resolutionSessionDate,
    resolutionPrice: round.resolutionPrice,
    propositionKind: round.proposition_kind,
    locale,
    t,
  })

  return (
    <div className="px-4 pt-4 pb-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-league-accent" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-bold leading-snug text-league-fg md:text-lg">{headline}</p>
            <p className="mt-0.5 text-[11px] text-league-fg-muted">
              {round.horizon} · {formatCategory(round.category)}
            </p>
          </div>
        </div>
        <StatusBadge round={round} hitRate={hitRate} t={t} stalled={gradingStalled} />
      </div>
      {window ? <p className="mt-2 text-[12px] leading-snug text-league-fg">{window}</p> : null}
      {round.anchorPrice !== null && round.livePrice !== null ? (
        <p className="mt-1 text-[11px] text-league-fg-muted" dir="ltr">
          <span className="font-semibold text-league-fg">
            {formatInstrumentPrice(round.instrument, round.anchorPrice)}
          </span>{' '}
          {t.header.atPrediction}
          <span className="mx-1.5 text-league-fg-muted">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden />
            {t.header.live} {formatInstrumentPrice(round.instrument, round.livePrice)} · {t.header.liveSecondary}
          </span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * ONE status indicator. An ungraded round used to show both "hit rate
 * pending" and "grading…" — the same fact twice. Graded rounds keep the
 * hit-rate figure; everything else is a single grading-state badge.
 */
function StatusBadge({
  round,
  hitRate,
  t,
  stalled,
}: {
  round: CardRoundMeta
  hitRate: HitRateSummary
  t: LeagueUiPack
  stalled: boolean
}) {
  const kind = cardStatusKind(round, hitRate, stalled)
  if (kind === 'hit_rate') return <HitRateBadge hitRate={hitRate} t={t} />

  const copy = cardStatusCopy(kind, round.unresolvableReason, t, round.proposition_kind)
  return (
    <div className="max-w-[11rem] shrink-0 text-right md:max-w-xs">
      <span className="inline-flex items-center rounded-full bg-league-bg-elevated px-2.5 py-1 text-[11px] font-semibold text-league-fg-muted">
        {copy.badge}
      </span>
      {copy.note ? <p className="mt-1 text-[10px] leading-snug text-league-fg-muted">{copy.note}</p> : null}
    </div>
  )
}

function HitRateBadge({ hitRate, t }: { hitRate: HitRateSummary; t: LeagueUiPack }) {
  const label =
    hitRate.graded > 0
      ? t.hitRate.roundResult(hitRate.correct ?? 0, hitRate.graded)
      : t.hitRate.pending
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        hitRate.graded > 0
          ? 'bg-league-accent-soft text-league-accent-strong'
          : 'bg-league-bg-elevated text-league-fg-muted'
      }`}
    >
      {label}
    </span>
  )
}

/** Category is a technical/data label (like a ticker), not translated chrome — see i18n dictionary scoping note. */
function formatCategory(category: string): string {
  return category.replace(/_/g, ' ')
}
