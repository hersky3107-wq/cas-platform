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
 * once the parent grid gives it a column. Reasoning stays collapsed until
 * the user asks — the grid stays dense.
 *
 * Direction copy comes only from `directionBadgeLabel` (never buy/sell).
 * `reasoning_snippet` is the model's own quote, rendered verbatim.
 */
export function ModelTile({ model, t }: { model: CardModelPrediction; t: LeagueUiPack }) {
  const [open, setOpen] = useState(false)
  const hasReasoning = Boolean(model.reasoning_snippet)
  const dirStyle = model.direction ? DIRECTION_STYLE[model.direction] : NO_CALL_STYLE
  const glyph = model.direction ? DIRECTION_GLYPH[model.direction] : '–'
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
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left disabled:cursor-default md:flex-col md:items-stretch md:gap-1.5 md:px-3 md:py-2.5"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 md:justify-between">
          <span className="truncate text-[13px] font-semibold text-league-fg md:text-sm">{model.brand}</span>
          <CountryFlag brand={model.brand} camp={model.camp} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 md:justify-between">
          <span className="inline-flex items-center gap-1">
            {pct ? (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-league-fg-muted">
                {t.bracket.confidence}
              </span>
            ) : null}
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[12px] font-bold tabular-nums ${dirStyle}`}
            >
              <span aria-hidden>{glyph}</span>
              <span className="sr-only">{badge}</span>
              {pct ? <span>{pct}</span> : <span className="text-[10px] font-semibold">{badge}</span>}
            </span>
          </span>
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
      </button>
      {open && model.reasoning_snippet ? (
        <p className="border-t border-league-border/40 px-2.5 py-2 text-[11px] leading-snug italic text-league-fg-muted md:px-3">
          &ldquo;{model.reasoning_snippet}&rdquo;
        </p>
      ) : null}
    </li>
  )
}

const DIRECTION_GLYPH: Record<Direction, string> = { up: '▲', down: '▼', flat: '■' }

const DIRECTION_STYLE: Record<Direction, string> = {
  up: 'bg-emerald-500/12 text-emerald-700',
  down: 'bg-rose-500/12 text-rose-700',
  flat: 'bg-slate-500/10 text-slate-600',
}

const NO_CALL_STYLE = 'bg-slate-400/10 text-slate-500'
