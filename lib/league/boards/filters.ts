import { FINANCE_LEDGER_CATEGORIES, WORLD_LEDGER_CATEGORIES } from '../hub-doors'
import {
  BOARD_HORIZONS,
  BOARD_PERIODS,
  type BoardDoor,
  type BoardFilters,
  type BoardHorizon,
  type BoardPeriod,
  type BoardRound,
} from './types'

/**
 * Leaderboard filters and the cache signature (pure, client-safe).
 *
 * A signature names the exact round set a board was computed from, so two
 * requests that select the same rounds share one cache row: a category always
 * implies its door, and a door whose only categories with data are also the
 * whole league's collapses to `all`.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const FINANCE = new Set<string>(FINANCE_LEDGER_CATEGORIES)
const WORLD = new Set<string>(WORLD_LEDGER_CATEGORIES)

export function boardDoorOfCategory(category: string): 'finance' | 'world' | null {
  if (FINANCE.has(category)) return 'finance'
  if (WORLD.has(category)) return 'world'
  return null
}

export function categoriesForDoor(door: BoardDoor, universe: readonly string[]): string[] {
  if (door === 'all') return [...universe]
  return universe.filter((category) => boardDoorOfCategory(category) === door)
}

function pick<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export function parseBoardDoor(value: string | null | undefined, fallback: BoardDoor = 'all'): BoardDoor {
  return pick(value, ['finance', 'world', 'all'] as const, fallback)
}

/** Unknown values fall back to the defaults; a category implies its door. */
export function parseBoardFilters(
  get: (name: string) => string | null | undefined,
  fallbackDoor: BoardDoor = 'all',
): BoardFilters {
  const rawCategory = get('cat')?.trim() || null
  return normalizeBoardFilters({
    door: parseBoardDoor(get('door'), fallbackDoor),
    category: rawCategory && /^[a-z_]+$/.test(rawCategory) ? rawCategory : null,
    horizon: pick<BoardHorizon>(get('h'), BOARD_HORIZONS, 'all'),
    period: pick<BoardPeriod>(get('p'), BOARD_PERIODS, 'all'),
  })
}

export function normalizeBoardFilters(filters: BoardFilters): BoardFilters {
  if (!filters.category) return { ...filters, category: null }
  const door = boardDoorOfCategory(filters.category)
  if (filters.door !== 'all' && door !== null && door !== filters.door) {
    return { ...filters, category: null }
  }
  return filters
}

/**
 * Categories a request covers. `visible` null is the unfiltered (admin) view;
 * otherwise the viewer's jurisdiction allow-list narrows every scope.
 */
export function scopeCategories(
  filters: BoardFilters,
  universe: readonly string[],
  visible: readonly string[] | null,
): string[] {
  const allowed = visible ? new Set(visible) : null
  const base = filters.category ? [filters.category] : categoriesForDoor(filters.door, universe)
  return base.filter((category) => !allowed || allowed.has(category))
}

/**
 * Canonical scope name. `withData` is the categories that have any public
 * graded round; categories outside it select nothing, so they are dropped
 * before naming.
 */
export function scopeKey(categories: readonly string[], withData: readonly string[]): string {
  const data = new Set(withData)
  const effective = [...new Set(categories)].filter((category) => data.has(category)).sort()
  if (effective.length === 0) return 'none'
  const same = (other: readonly string[]) => {
    const sorted = [...other].sort()
    return sorted.length === effective.length && sorted.every((category, i) => category === effective[i])
  }
  if (same(withData)) return 'all'
  if (same(categoriesForDoor('finance', withData))) return 'finance'
  if (same(categoriesForDoor('world', withData))) return 'world'
  if (effective.length === 1) return `cat:${effective[0]}`
  return `set:${effective.join(',')}`
}

export function categoriesOfScopeKey(key: string, withData: readonly string[]): string[] {
  if (key === 'none') return []
  if (key === 'all') return [...withData]
  if (key === 'finance' || key === 'world') return categoriesForDoor(key, withData)
  if (key.startsWith('cat:')) return [key.slice(4)]
  if (key.startsWith('set:')) return key.slice(4).split(',').filter(Boolean)
  return []
}

export function boardSignature(scope: string, horizon: BoardHorizon, period: BoardPeriod): string {
  return `${scope}|h=${horizon}|p=${period}`
}

/** KST calendar start of the window, or null for all time. */
export function periodStartMs(period: BoardPeriod, nowMs: number): number | null {
  if (period === 'all') return null
  const local = new Date(nowMs + KST_OFFSET_MS)
  const y = local.getUTCFullYear()
  const m = local.getUTCMonth()
  const d = local.getUTCDate()
  if (period === 'month') return Date.UTC(y, m, 1) - KST_OFFSET_MS
  const todayStart = Date.UTC(y, m, d) - KST_OFFSET_MS
  if (period === 'week') {
    const sinceMonday = (local.getUTCDay() + 6) % 7
    return todayStart - sinceMonday * DAY_MS
  }
  return todayStart - 89 * DAY_MS
}

/** 'YYYY-MM' in KST. */
export function kstMonth(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 7)
}

/** Whole KST days since the epoch — rotates the daily highlight. */
export function kstDayIndex(nowMs: number): number {
  return Math.floor((nowMs + KST_OFFSET_MS) / DAY_MS)
}

export function selectRounds(
  rounds: readonly BoardRound[],
  opts: { categories: readonly string[]; horizon: BoardHorizon; period: BoardPeriod; nowMs: number },
): BoardRound[] {
  const categories = new Set(opts.categories)
  const start = periodStartMs(opts.period, opts.nowMs)
  return rounds.filter((round) => {
    if (!categories.has(round.category)) return false
    if (opts.horizon !== 'all' && round.horizon !== opts.horizon) return false
    if (start !== null) {
      const at = Date.parse(round.resolvesAt)
      if (!Number.isFinite(at) || at < start) return false
    }
    return true
  })
}
