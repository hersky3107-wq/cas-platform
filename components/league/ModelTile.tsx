'use client'

import { useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { directionBadgeLabel } from '@/lib/league/compliance'
import type { CardModelPrediction, Direction } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { CountryFlag } from '@/components/league/CountryFlag'

/**
 * One AI as a team card / ticker tile.
 *
 * Graded tiles: large ✓/✗ result stamp first, direction banner secondary.
 * Ungraded tiles: direction hero first (unchanged). Then brand → model
 * identifier → country flag → clipped rationale → expand control.
 * Confidence is never a collapsed-tile headline.
 *
 * Direction copy comes only from `directionBadgeLabel` (never buy/sell).
 * `reasoning_snippet` is the model's own quote, rendered verbatim.
 */
export function ModelTile({
  model,
  t,
  roundGraded = false,
  translatedRationale = null,
  showOriginal = false,
}: {
  model: CardModelPrediction
  t: LeagueUiPack
  roundGraded?: boolean
  translatedRationale?: string | null
  showOriginal?: boolean
}) {
  const [open, setOpen] = useState(false)
  const original = model.reasoning_snippet?.trim() || null
  const rationale = (translatedRationale?.trim() || original) ?? null
  const hasReasoning = Boolean(rationale)
  const dirStyle = model.direction ? DIRECTION_STYLE[model.direction] : NO_CALL_STYLE
  const glyph = model.direction ? DIRECTION_GLYPH[model.direction] : '\u2013'
  const badge = directionBadgeLabel(model.direction, t)
  const pct = model.direction && model.probability !== null ? `${Math.round(model.probability)}%` : null

  function toggle() {
    if (!hasReasoning) return
    setOpen((v) => !v)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!hasReasoning) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  return (
    <li className="rounded-lg border border-league-border/50 bg-league-bg-elevated">
      <div
        role={hasReasoning ? 'button' : undefined}
        tabIndex={hasReasoning ? 0 : undefined}
        aria-expanded={hasReasoning ? open : undefined}
        aria-label={hasReasoning ? (open ? t.modelTile.hideWhy : t.modelTile.showWhy) : undefined}
        onClick={toggle}
        onKeyDown={onKeyDown}
        className={`flex w-full flex-col items-stretch gap-1.5 px-2.5 py-2.5 text-left md:px-3 md:py-3 ${
          hasReasoning
            ? 'cursor-pointer rounded-lg transition-colors hover:bg-league-accent-soft/40 active:bg-league-accent-soft/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-league-accent'
            : ''
        }`}
      >
        {model.is_correct !== null ? (
          <>
            <div
              className={`flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2 md:py-2.5 ${
                model.is_correct ? 'bg-emerald-500/15 text-emerald-700' : 'bg-rose-500/15 text-rose-700'
              }`}
            >
              <span className="text-[34px] font-black leading-none md:text-3xl" aria-hidden>
                {model.is_correct ? '\u2713' : '\u2717'}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wide md:text-xs">
                {model.is_correct ? t.modelList.correct : t.modelList.missed}
              </span>
            </div>
            <div
              dir="ltr"
              className={`flex shrink-0 items-center justify-center gap-1 rounded-md px-2 py-0.5 ${dirStyle}`}
            >
              <span className="text-[12px] font-black leading-none" aria-hidden>
                {glyph}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide">{badge}</span>
            </div>
          </>
        ) : (
          <div
            dir="ltr"
            className={`flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-1.5 md:flex-row md:justify-center md:gap-1.5 md:py-2 ${dirStyle}`}
          >
            <span className="text-[30px] font-black leading-none md:text-2xl" aria-hidden>
              {glyph}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide md:text-xs">{badge}</span>
          </div>
        )}

        <p className="text-[13px] font-semibold leading-snug text-league-fg md:text-sm">{model.brand}</p>
        <p
          className="font-mono text-[12px] leading-tight text-league-fg-muted md:text-[13px]"
          aria-label={`${t.modelTile.modelLabel}: ${model.model_identifier}`}
        >
          {model.model_identifier}
        </p>
        <CountryFlag brand={model.brand} camp={model.camp} />

        {rationale ? (
          <p className={`text-[11px] leading-snug italic text-league-fg-muted ${open ? '' : 'line-clamp-2'}`}>
            &ldquo;{rationale}&rdquo;
          </p>
        ) : null}

        {open && showOriginal && translatedRationale && original && translatedRationale.trim() !== original ? (
          <p className="text-[10px] leading-snug text-league-fg-muted">
            <span className="font-semibold not-italic">{t.modelTile.originalLabel}: </span>
            &ldquo;{original}&rdquo;
          </p>
        ) : null}

        {hasReasoning ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-league-accent-strong">
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
            {open ? t.modelTile.hideWhy : t.modelTile.showWhy}
          </span>
        ) : null}

        {open && pct ? (
          <p className="text-[10px] font-medium text-league-fg-muted">
            {t.bracket.confidence} <span className="tabular-nums">{pct}</span>
          </p>
        ) : null}

        {model.is_correct === null && roundGraded && model.direction ? (
          <span className="self-start rounded bg-league-bg px-1 py-0.5 text-[10px] font-bold text-league-fg-muted">
            {t.modelList.ungraded}
          </span>
        ) : null}
      </div>
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
