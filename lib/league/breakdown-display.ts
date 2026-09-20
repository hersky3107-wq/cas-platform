/**
 * Display-only accent classes for 자세히보기 camp / tier / book / weights rows.
 * No numbers live here — callers still read server tallies.
 */

import type { Camp, LeagueTier } from './card-types'

export const CAMP_ACCENT: Record<Camp, string> = {
  us: 'bg-sky-500',
  china: 'bg-rose-500',
  other: 'bg-amber-500',
}

export const TIER_ACCENT: Record<LeagueTier, string> = {
  premier: 'bg-rose-500',
  challenger: 'bg-sky-500',
  world: 'bg-emerald-500',
  scout: 'bg-violet-500',
  extra: 'bg-amber-500',
}

export const BOOK_ACCENT: Record<'closed' | 'scout', string> = {
  closed: 'bg-slate-500',
  scout: 'bg-violet-500',
}

export const WEIGHT_ACCENT: Record<'closed' | 'open', string> = {
  closed: 'bg-zinc-500',
  open: 'bg-teal-500',
}

export const SIDE_UP_CLASS = 'text-emerald-600'
export const SIDE_DOWN_CLASS = 'text-rose-600'
export const SIDE_MUTED_CLASS = 'text-league-fg-muted'
