import type { CardRoundMeta, HitRateSummary } from '@/lib/league/card-types'
import { cardStatusCopy, cardStatusKind } from '@/lib/league/card-status'
import {
  formatInstrumentPrice,
  formatRoundOpenedDate,
  financeCardSubhead,
  headerHeadline,
  headerWindow,
} from '@/lib/league/card-header-copy'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { getLeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { formatPropertyGradeLine, formatPropertyHorizonLabel } from '@/lib/league/real-estate-display'
import type { ToneTokens } from '@/lib/league/tone'
import { KrDataNotice } from '@/components/league/KrLaneDisclosureBlocks'
import { airankGradingFootnote } from '@/lib/league/ai-ranking/instrument'
import { isNonFinancialCategory } from '@/lib/league/compliance'
import { resolveLocalizedProposition } from '@/lib/league/proposition-i18n'
import { techCardHeaderLine, techEventFromInstrument } from '@/lib/league/tech-labels'
import { sportsCardHeaderLine } from '@/lib/league/sports-display'

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
  t: tProp,
  locale,
  gradingStalled = false,
  showKrDataNotice = false,
}: {
  round: CardRoundMeta
  hitRate: HitRateSummary
  tone: ToneTokens
  t?: LeagueUiPack
  locale: LeagueLocale
  gradingStalled?: boolean
  showKrDataNotice?: boolean
}) {
  void tone
  const t = tProp ?? getLeagueUiPack(locale)
  const roundDate = formatRoundOpenedDate(round.opened_at, locale)
  const propertyHorizon = round.category === 'real_estate' ? formatPropertyHorizonLabel(round.instrument, t) : null
  const propertyGrade =
    round.category === 'real_estate'
      ? formatPropertyGradeLine({
          instrument: round.instrument,
          resolvesAt: round.resolves_at,
          locale,
          t,
        })
      : null
  const headline = headerHeadline({
    roundDate,
    instrument: round.instrument,
    anchorPrice: round.anchorPrice,
    anchorSessionDate: round.anchorSessionDate,
    propositionKind: round.proposition_kind,
    subjectLabel: round.subject_label,
    propositionText: resolveLocalizedProposition(round, locale),
    horizon: round.horizon,
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
            {round.category === 'ai_models' ? null : (
              <p className="mt-0.5 text-[11px] text-league-fg-muted" data-testid="card-subhead">
                {techSubhead(round, locale, t) ??
                  (round.category === 'sports' ? sportsCardHeaderLine(round.instrument, locale) : null) ??
                  financeCardSubhead({
                    category: round.category,
                    instrument: round.instrument,
                    horizon: round.horizon,
                    subjectLabel: round.subject_label,
                    propositionText: round.proposition_text,
                    horizonLabel:
                      propertyHorizon ??
                      t.catalog.horizons[round.horizon as '1d' | '1w' | '1m' | '3m'] ??
                      round.horizon,
                  }) ??
                  `${propertyHorizon ?? t.catalog.horizons[round.horizon as '1d' | '1w' | '1m' | '3m'] ?? round.horizon} · ${formatCategory(round.category)}`}
              </p>
            )}
          </div>
        </div>
        <StatusBadge round={round} hitRate={hitRate} t={t} stalled={gradingStalled} />
      </div>
      {window ? <p className="mt-2 text-[12px] leading-snug text-league-fg">{window}</p> : null}
      {propertyGrade ? (
        <p className="mt-1.5 text-[12px] font-semibold leading-snug text-league-fg">{propertyGrade}</p>
      ) : null}
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
      {showKrDataNotice && !isNonFinancialCategory(round.category) ? <KrDataNotice /> : null}
      {round.category === 'ai_models' ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-league-fg-muted">{airankGradingFootnote(locale)}</p>
      ) : null}
      {round.category === 'gold_metal' ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-league-fg-muted">
          {t.header.metalsSpotNote}
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

function techSubhead(round: CardRoundMeta, locale: LeagueLocale, t: LeagueUiPack): string | null {
  if (round.category !== 'tech') return null
  const event = techEventFromInstrument(round.instrument)
  if (!event) return null
  const horizonLabel =
    t.catalog.horizons[round.horizon as '1d' | '1w' | '1m' | '3m'] ?? round.horizon
  return techCardHeaderLine({
    subject: round.subject_label?.trim() || 'Tech',
    event,
    horizonLabel,
    locale,
  })
}
