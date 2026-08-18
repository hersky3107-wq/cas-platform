'use client'

import { useState } from 'react'
import { directionBadgeLabel } from '@/lib/league/compliance'
import type { CardModelPrediction, Direction } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { CountryFlag } from '@/components/league/CountryFlag'

/**
 * One AI as a team card / ticker tile.
 *
 * ONE component, CSS-only responsive: a slim row at 375px, a compact tile
 * once the parent grid gives it a column. Reading order is now "trader's
 * screen": DIRECTION is the largest, first thing you see (glyph + word,
 * semantic color) — everything else (brand, flag, confidence, rationale) is
 * secondary. Confidence is small/muted text, never competing with direction
 * for attention. The reasoning preview is visible by default (clamped to 2
 * lines); tapping still expands to the full text.
 *
 * Direction copy comes only from `directionBadgeLabel` (never buy/sell).
 * `reasoning_snippet` is the model's own quote, rendered verbatim.
 */
export function ModelTile({ model, t }: { model: CardModelPrediction; t: LeagueUiPack }) {
  const [open, setOpen] = useState(false)
  const rationale = model.reasoning_snippet?.trim() || null
  const hasReasoning = Boolean(rationale)
  const dirStyle = model.direction ? DIRECTION_STYLE[model.direction] : NO_CALL_STYLE
  const glyph = model.direction ? DIRECTION_GLYPH[model.direction] : '\u2013'
  const badge = directionBadgeLabel(model.direction, t)
  const pct = model.direction && model.probability !== null ? `${Math.round(model.probability)}%` : null

  return (
    <li className="rounded-lg border border-league-border/50 bg-league-bg-elevated">
      <button
        type="button"
        disabled={!hasReasoning}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={hasReasoning ? open : undefined}
        aria-label={hasReasoning ? (open ? t.bracket.hideReasoning : t.bracket.showReasoning) : undefined}
        className="flex w-full items-stretch gap-2.5 px-2.5 py-2.5 text-left disabled:cursor-default md:flex-col md:gap-2 md:px-3 md:py-3"
      >
        {/* DIRECTION IS THE HERO — largest element in the row, at a glance while scrolling 40 rows. */}
        <div
          dir="ltr"
          className={`flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-1.5 md:w-full md:flex-row md:justify-center md:gap-1.5 md:py-2 ${dirStyle}`}
        >
          <span className="text-[30px] font-black leading-none md:text-2xl" aria-hidden>
            {glyph}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wide md:text-xs">{badge}</span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex min-w-0 items-center justify-between gap-1.5">
            <span className="truncate text-[13px] font-semibold text-league-fg md:text-sm">{model.brand}</span>
            <CountryFlag brand={model.brand} camp={model.camp} />
          </div>

          <div className="flex items-center justify-between gap-1.5">
            {pct ? (
              <span className="text-[10px] font-medium text-league-fg-muted">
                {t.bracket.confidence} <span className="tabular-nums">{pct}</span>
              </span>
            ) : (
              <span />
            )}
            {model.is_correct !== null ? (
              <span
                className={`rounded px-1 py-0.5 text-[10px] font-bold ${
                  model.is_correct ? 'bg-emerald-500/15 text-emerald-700' : 'bg-rose-500/15 text-rose-700'
                }`}
              >
                {model.is_correct ? t.modelList.correct : t.modelList.missed}
              </span>
            ) : null}
          </div>

          {rationale ? (
            <p className={`text-[11px] leading-snug italic text-league-fg-muted ${open ? '' : 'line-clamp-2'}`}>
              &ldquo;{rationale}&rdquo;
            </p>
          ) : null}
        </div>
      </button>
    </li>
  )
}

const DIRECTION_GLYPH: Record<Direction, string> = { up: '\u25b2', down: '\u25bc', flat: '\u25a0' }

const DIRECTION_STYLE: Record<Direction, string> = {
  up: 'bg-emerald-500/15 text-emerald-700',
  down: 'bg-rose-500/15 text-rose-700',
  flat: 'bg-slate-500/12 text-slate-600',
}

const NO_CALL_STYLE = 'bg-slate-400/12 text-slate-500'
