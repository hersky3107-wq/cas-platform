import type { CardRoundMeta, HitRateSummary } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { ToneTokens } from '@/lib/league/tone'

/**
 * Header: instrument + tone dot + AI-hit-rate badge, plus (below) the price
 * block — the ANCHOR price (what the instrument was at when this round
 * opened, which is what makes every model's up/down call legible) and,
 * secondarily, a best-effort LIVE price if the cache has one.
 *
 * Price shown ONCE, here. Individual model tiles never repeat it — see
 * `ModelTile.tsx`.
 *
 * Both prices are nullable and the layout is designed to look intentional
 * with either or both absent (older rounds predate `anchorPrice`; `livePrice`
 * is a cache that can be cold or a provider hiccup) — never a bare "$" or a
 * layout jump.
 */
export function CardHeader({
  round,
  hitRate,
  t,
}: {
  round: CardRoundMeta
  hitRate: HitRateSummary
  tone: ToneTokens
  t: LeagueUiPack
}) {
  return (
    <div className="px-4 pt-4 pb-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-league-accent" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-league-fg md:text-xl">{round.instrument}</p>
            <p className="truncate text-[11px] text-league-fg-muted">
              {round.horizon} · {formatCategory(round.category)}
            </p>
          </div>
        </div>
        <HitRateBadge hitRate={hitRate} t={t} />
      </div>
      <PriceBlock round={round} t={t} />
    </div>
  )
}

function PriceBlock({ round, t }: { round: CardRoundMeta; t: LeagueUiPack }) {
  if (round.anchorPrice === null && round.livePrice === null) return null

  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5" dir="ltr">
      {round.anchorPrice !== null ? (
        <>
          <span className="font-mono text-xl font-extrabold tabular-nums text-league-fg md:text-2xl">
            {formatInstrumentPrice(round.instrument, round.anchorPrice)}
          </span>
          <span className="text-[11px] text-league-fg-muted">
            {t.header.atPrediction}
            {round.anchorPriceAt ? ` · ${formatShortDate(round.anchorPriceAt)}` : ''}
          </span>
        </>
      ) : null}
      {round.livePrice !== null ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-league-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-league-accent-strong">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden />
          {t.header.live} {formatInstrumentPrice(round.instrument, round.livePrice)} · {t.header.now}
        </span>
      ) : null}
    </div>
  )
}

function HitRateBadge({ hitRate, t }: { hitRate: HitRateSummary; t: LeagueUiPack }) {
  const label = hitRate.hitRatePct !== null ? t.hitRate.pct(hitRate.hitRatePct) : t.hitRate.pending
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full bg-league-accent-soft px-2.5 py-1 text-[11px] font-semibold text-league-accent-strong">
      {label}
    </span>
  )
}

/** Category is a technical/data label (like a ticker), not translated chrome — see i18n dictionary scoping note. */
function formatCategory(category: string): string {
  return category.replace(/_/g, ' ')
}

/**
 * Best-effort currency glyph from the instrument string. Presentation only —
 * `USD/KRW` and `USD/JPY` quote in the SECOND currency (Twelve Data
 * base/quote convention), everything else in this catalog quotes in USD.
 */
function currencyGlyph(instrument: string): string {
  if (instrument.includes('/')) {
    const quote = instrument.split('/')[1]?.toUpperCase()
    if (quote === 'KRW') return '\u20a9'
    if (quote === 'JPY') return '\u00a5'
    if (quote === 'USD') return '$'
    return ''
  }
  return '$'
}

function formatInstrumentPrice(instrument: string, value: number): string {
  const decimals = Math.abs(value) < 10 ? 4 : 2
  const formatted = value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return `${currencyGlyph(instrument)}${formatted}`
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
