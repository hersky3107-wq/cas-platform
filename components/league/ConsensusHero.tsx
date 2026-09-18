import type { ConsensusSummary } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { sideLabelsFor, type SideLabels } from '@/lib/league/side-labels'
import { buildConsensusHero, heroSideWords, magnitudeCompareLine } from '@/lib/league/compliance'

/**
 * Glanceable consensus hero — count first, conclusion second, confidence last.
 * Used on BOTH pending and graded cards via `PendingVerdictPanel` / `VerdictPanel`.
 *
 * Direction counts render as `{n}{glyph}` (▲▼ / YN / ><) — never a
 * slash-over-total and never ✓/✗. Hit counts live elsewhere.
 *
 * Seat-resolution gate: while `seatComplete` is false the locked conclusion,
 * confidence, and magnitude are withheld. Only a live head-count tally
 * (and the pending placeholder) may render.
 */
export function ConsensusHero({
  consensus,
  horizon,
  t,
  labels,
  magnitudeCompare = null,
  seatComplete = true,
  answered,
}: {
  consensus: ConsensusSummary
  horizon: string
  t: LeagueUiPack
  /** The round's side-label resolver. Omitted only by legacy price-round callers. */
  labels?: SideLabels
  /** Round-level predicted (aggregate) vs actual magnitude — graded cards only. */
  magnitudeCompare?: { predictedPct: number; actualPct: number } | null
  /**
   * Seat-resolution flag (`generation.complete`). Default true so static
   * cards keep the locked conclusion. False while seats are still filling.
   */
  seatComplete?: boolean
  /** Resolved-seat count for the live tally line (tiles + drops). */
  answered?: number
}) {
  const sl = labels ?? sideLabelsFor({}, t)
  const price = sl.kind === 'binary_close_higher'
  const barHeading = price ? t.verdict.distributionHeading : t.verdict.distributionHeadingSides

  if (!seatComplete) {
    const { upWord, downWord } = heroSideWords(t, labels)
    const up = consensus.tally.up
    const down = consensus.tally.down
    const none = consensus.tally.flat + consensus.tally.abstain
    const n = answered ?? up + down + none
    return (
      <div className="mt-3" data-testid="consensus-hero" data-seat-complete="false">
        <p
          className="text-xl font-extrabold leading-tight text-league-fg md:text-2xl"
          data-testid="consensus-count-line"
        >
          {t.hero.liveCountLine(n, upWord, up, downWord, down)}
        </p>
        <DirectionRatioBar
          up={up}
          down={down}
          none={none}
          upWord={upWord}
          downWord={downWord}
          labels={sl}
          t={t}
          heading={barHeading}
        />
        <p
          className="mt-3 text-base font-semibold leading-snug text-league-fg-muted md:text-lg"
          data-testid="consensus-conclusion-pending"
        >
          {t.hero.conclusionPending}
        </p>
      </div>
    )
  }

  const hero = buildConsensusHero(consensus, horizon, t, labels)
  if (!hero) return null

  if (hero.kind === 'fallback') {
    const hasBar = (hero.upCount ?? 0) + (hero.downCount ?? 0) > 0
    return (
      <div className="mt-3" data-testid="consensus-hero" data-seat-complete="true">
        {hasBar && hero.countLine ? (
          <>
            <p
              className="text-xl font-extrabold leading-tight text-league-fg md:text-2xl"
              data-testid="consensus-count-line"
            >
              {hero.countLine}
            </p>
            <DirectionRatioBar
              up={hero.upCount ?? 0}
              down={hero.downCount ?? 0}
              none={hero.noDirectionCount ?? 0}
              upWord={hero.upWord ?? ''}
              downWord={hero.downWord ?? ''}
              labels={sl}
              t={t}
              heading={barHeading}
            />
          </>
        ) : null}
        <p className="mt-2 text-sm font-medium leading-snug text-league-fg-muted">{hero.message}</p>
      </div>
    )
  }

  const magSuffix =
    hero.signedMagnitude && hero.horizonLabel ? (
      <span className="ml-1.5 text-base font-semibold text-league-fg-muted md:text-lg">
        {hero.signedMagnitude}
        <span className="mx-1 text-league-fg-muted">·</span>
        {hero.horizonLabel}
      </span>
    ) : hero.signedMagnitude ? (
      <span className="ml-1.5 text-base font-semibold text-league-fg-muted md:text-lg">{hero.signedMagnitude}</span>
    ) : null

  return (
    <div className="mt-3" data-testid="consensus-hero" data-seat-complete="true">
      <p
        className="text-xl font-extrabold leading-tight text-league-fg md:text-2xl"
        data-testid="consensus-count-line"
      >
        {hero.countLine}
      </p>
      <DirectionRatioBar
        up={hero.upCount}
        down={hero.downCount}
        none={hero.noDirectionCount}
        upWord={hero.upWord}
        downWord={hero.downWord}
        labels={sl}
        t={t}
        heading={barHeading}
      />
      <div className="mt-3">
        <div
          className="text-2xl font-extrabold leading-tight text-league-fg md:text-3xl"
          data-testid="consensus-conclusion"
        >
          {hero.diverged ? (
            <>
              <span>{t.hero.weightedCallPrefix.trimEnd()}</span>
              <details className="relative ml-1 inline-block align-middle">
                <summary
                  className="cursor-help list-none text-[11px] font-semibold text-league-fg-muted underline decoration-dotted [&::-webkit-details-marker]:hidden"
                  title={t.hero.weightedCallHelp}
                >
                  ?
                </summary>
                <div className="absolute left-0 z-10 mt-1 w-64 rounded-md border border-league-border bg-white px-2 py-1.5 text-[11px] font-medium leading-snug text-league-fg-muted shadow-sm">
                  {t.hero.weightedCallHelp}
                </div>
              </details>{' '}
              {hero.conclusionLine.startsWith(t.hero.weightedCallPrefix)
                ? hero.conclusionLine.slice(t.hero.weightedCallPrefix.length)
                : hero.conclusionVerb}
              {magSuffix}
            </>
          ) : (
            <>
              {hero.conclusionLine}
              {magSuffix}
            </>
          )}
        </div>
        {hero.diverged ? (
          <p className="mt-1 text-[11px] font-medium leading-snug text-league-fg-muted">{hero.line2}</p>
        ) : hero.confidencePct !== null ? (
          <p className="mt-1 text-[11px] font-medium leading-snug text-league-fg-muted">
            {t.hero.confidenceNote(hero.confidencePct)}
          </p>
        ) : null}
      </div>
      {magnitudeCompare ? (
        <p className="mt-1.5 text-[11px] font-medium text-league-fg-muted" dir="ltr">
          {magnitudeCompareLine(magnitudeCompare.predictedPct, magnitudeCompare.actualPct, t)}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Side-count bar. GLYPH LAW: `{n}{side glyph}` — never slash-over-total, never ✓.
 */
function DirectionRatioBar({
  up,
  down,
  none,
  upWord,
  downWord,
  labels,
  t,
  heading,
}: {
  up: number
  down: number
  none: number
  upWord: string
  downWord: string
  labels: SideLabels
  t: LeagueUiPack
  heading: string
}) {
  const total = up + down + none
  if (total <= 0) return null
  const upPct = (up / total) * 100
  const downPct = (down / total) * 100
  const nonePct = (none / total) * 100
  const price = labels.kind === 'binary_close_higher'
  const srA = price ? t.verdict.distributionUp : labels.badge(labels.sides[0])
  const srB = price ? t.verdict.distributionDown : labels.badge(labels.sides[1])

  return (
    <div className="mt-3" data-testid="direction-ratio-bar">
      <p className="sr-only">{heading}</p>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-3xl font-black tabular-nums tracking-tight text-emerald-600 md:text-4xl">
            {up}
            {labels.glyphs[0]}
            <span className="sr-only"> {srA}</span>
          </p>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-emerald-800">{upWord}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-3xl font-black tabular-nums tracking-tight text-rose-600 md:text-4xl">
            {down}
            {labels.glyphs[1]}
            <span className="sr-only"> {srB}</span>
          </p>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-rose-800">{downWord}</p>
        </div>
      </div>
      <div className="mt-2 flex h-3.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        {up > 0 ? <span className="bg-emerald-500" style={{ width: `${upPct}%` }} /> : null}
        {down > 0 ? <span className="bg-rose-500" style={{ width: `${downPct}%` }} /> : null}
        {none > 0 ? <span className="bg-slate-400" style={{ width: `${nonePct}%` }} /> : null}
      </div>
      {none > 0 ? (
        <p className="mt-1 text-[10px] text-slate-600">
          {none}– <span className="sr-only">{t.verdict.distributionNoDirection}</span>
        </p>
      ) : null}
    </div>
  )
}
