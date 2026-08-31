'use client'

import { useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { directionBadgeLabel, magnitudeCompareLine } from '@/lib/league/compliance'
import type { CardModelPrediction } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { SideLabels, SideSlot } from '@/lib/league/side-labels'
import { formatSignedPercent } from '@/lib/league/magnitude'
import { CountryFlag } from '@/components/league/CountryFlag'

/**
 * One AI as a team card / ticker tile.
 *
 * Graded tiles: large ✓/✗ result stamp first, side banner secondary.
 * Ungraded tiles: side hero first (unchanged). Then brand → model
 * identifier → country flag → clipped rationale → expand control.
 * Confidence is never a collapsed-tile headline.
 *
 * Side WORD and GLYPH come from the round's `labels` (never from the stored
 * token alone): 상승/▲ on price rounds, 승/Y on subject-outcome rounds,
 * 상회/> on threshold rounds. Colour keys on the SLOT (side A green, side B
 * red) so every contract reads consistently. Copy still flows through
 * `directionBadgeLabel` (never buy/sell). `reasoning_snippet` is the model's
 * own quote, rendered verbatim.
 *
 * The QUALIFIER (magnitude "▲ +3.2%" on price rounds, `qualifierText`
 * "2-1" / "+3.4%p" on the others) renders NEXT TO the side badge — never
 * inside the ✓/✗ result stamp, so it can never be mistaken for the graded
 * outcome, and it never joins a hit fraction. `actualMagnitudePct`
 * (round-level, presentation only) enables a per-model "predicted X →
 * actual Y" line once the round is graded and this tile is expanded.
 */
export function ModelTile({
  model,
  t,
  labels,
  roundGraded = false,
  translatedRationale = null,
  showOriginal = false,
  actualMagnitudePct = null,
}: {
  model: CardModelPrediction
  t: LeagueUiPack
  /** The round's side-label resolver. Omitted only by legacy price-round callers. */
  labels?: SideLabels
  roundGraded?: boolean
  translatedRationale?: string | null
  showOriginal?: boolean
  /** Round-level actual percent change, once graded. Display only — see `lib/league/magnitude.ts`. */
  actualMagnitudePct?: number | null
}) {
  const [open, setOpen] = useState(false)
  const original = model.reasoning_snippet?.trim() || null
  const rationale = (translatedRationale?.trim() || original) ?? null
  const hasReasoning = Boolean(rationale)
  const slot: SideSlot = labels
    ? labels.slot(model.direction)
    : model.direction === 'up'
      ? 'a'
      : model.direction === 'down'
        ? 'b'
        : model.direction === 'flat'
          ? 'flat'
          : 'none'
  const dirStyle = SLOT_STYLE[slot]
  const glyph = labels ? labels.glyph(model.direction) : LEGACY_GLYPH[slot]
  const badge = directionBadgeLabel(model.direction, t, labels)
  const pct = model.direction && model.probability !== null ? `${Math.round(model.probability)}%` : null
  // ONE qualifier next to the badge: numeric magnitude on price rounds,
  // adapter-provided qualifier text (scoreline, margin) on the others.
  const magnitudeText =
    model.direction && model.magnitude !== null
      ? formatSignedPercent(model.magnitude)
      : model.direction && model.qualifierText
        ? model.qualifierText
        : null
  const magnitudeCompare =
    model.magnitude !== null && actualMagnitudePct !== null
      ? magnitudeCompareLine(model.magnitude, actualMagnitudePct, t)
      : null

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
              {magnitudeText ? (
                <span className="text-[10px] font-semibold tabular-nums" aria-hidden>
                  {magnitudeText}
                </span>
              ) : null}
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
            {magnitudeText ? (
              <span className="text-[10px] font-semibold tabular-nums" aria-hidden>
                {magnitudeText}
              </span>
            ) : null}
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

        {open && magnitudeCompare ? (
          <p className="text-[10px] font-medium text-league-fg-muted" dir="ltr">
            {magnitudeCompare}
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

/** Colour by SLOT so side A is always green and side B always red, per contract. */
const SLOT_STYLE: Record<SideSlot, string> = {
  a: 'bg-emerald-500/15 text-emerald-700',
  b: 'bg-rose-500/15 text-rose-700',
  flat: 'bg-slate-500/12 text-slate-600',
  none: 'bg-slate-400/12 text-slate-500',
}

/** Price glyphs for label-less legacy callers (byte-identical to pre-resolver tiles). */
const LEGACY_GLYPH: Record<SideSlot, string> = {
  a: '\u25b2',
  b: '\u25bc',
  flat: '\u25a0',
  none: '\u2013',
}
