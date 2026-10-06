import type { PublicCategoryId } from './catalog'
import type { PredictionCategory } from '@/lib/prediction/categories'

/** Markets. Order is the door’s chip order, not the catalog order. */
export const FINANCE_CATEGORY_IDS = [
  'stocks',
  'crypto',
  'fx',
  'gold_metals',
  'index_etf',
  'commodities_energy',
  'memecoin',
] as const satisfies readonly PublicCategoryId[]

/** Yes/no questions about the world. */
export const WORLD_CATEGORY_IDS = [
  'politics_election',
  'entertainment',
  'sports',
  'real_estate',
  'tech',
  'ai_ranking',
] as const satisfies readonly PublicCategoryId[]

/** `?cat=` values that name a chip by its ledger key. */
const CATEGORY_PARAM_ALIASES: Readonly<Record<string, PublicCategoryId>> = {
  ai_models: 'ai_ranking',
}

export function canonicalCategoryParam(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  return CATEGORY_PARAM_ALIASES[raw] ?? raw
}

/** Ledger categories that belong on the finance door (registration surface). */
export const FINANCE_LEDGER_CATEGORIES = [
  'stock',
  'crypto_spot',
  'crypto_perps',
  'fx',
  'gold_metal',
  'etf_index',
  'commodity_energy',
  'memecoin',
] as const satisfies readonly PredictionCategory[]

/** Ledger categories that belong on the world door. */
export const WORLD_LEDGER_CATEGORIES = [
  'politics_election',
  'entertainment_awards',
  'sports',
  'real_estate',
  'tech',
  'ai_models',
] as const satisfies readonly PredictionCategory[]

export type HubDoor = 'finance' | 'world'
export type HubDoorFilter = HubDoor | 'all'

export const HUB_DOOR_STORAGE_KEY = 'league.hub.door'

export function doorPath(door: HubDoor): string {
  return door === 'finance' ? '/league/finance' : '/league/world'
}

export function doorForCategory(id: string): HubDoor | null {
  if ((FINANCE_CATEGORY_IDS as readonly string[]).includes(id)) return 'finance'
  if ((WORLD_CATEGORY_IDS as readonly string[]).includes(id)) return 'world'
  return null
}

export function ledgerCategoriesForDoor(door: HubDoor): readonly PredictionCategory[] {
  return door === 'finance' ? FINANCE_LEDGER_CATEGORIES : WORLD_LEDGER_CATEGORIES
}

export function intersectDoorCategories(
  visible: readonly string[],
  door: HubDoor,
): string[] {
  const allowed = new Set<string>(ledgerCategoriesForDoor(door))
  return visible.filter((id) => allowed.has(id))
}

export function parseDoorParam(value: string | null | undefined): HubDoor | null {
  if (value === 'finance' || value === 'world') return value
  return null
}

export function parseHubTab(value: string | null | undefined): 'cards' | 'leaderboard' | 'recordRoom' | null {
  if (value === 'cards' || value === 'leaderboard' || value === 'recordRoom') return value
  return null
}

/** `/league/finance?cat=sports` → `/league/world?cat=sports`. */
export function redirectForDoorSearch(door: HubDoor, search: string): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(raw)
  const cat = canonicalCategoryParam(params.get('cat'))
  if (!cat) return null
  const owner = doorForCategory(cat)
  if (!owner || owner === door) return null
  const next = new URLSearchParams()
  next.set('cat', cat)
  const tab = parseHubTab(params.get('tab'))
  if (tab && tab !== 'cards') next.set('tab', tab)
  return `${doorPath(owner)}?${next.toString()}`
}

/** `/league?cat=sports` → `/league/world?cat=sports`. */
export function redirectForCategorySearch(search: string): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(raw)
  const cat = canonicalCategoryParam(params.get('cat'))
  if (!cat) return null
  const door = doorForCategory(cat)
  if (!door) return null
  const next = new URLSearchParams()
  next.set('cat', cat)
  const tab = parseHubTab(params.get('tab'))
  if (tab && tab !== 'cards') next.set('tab', tab)
  return `${doorPath(door)}?${next.toString()}`
}

export function chipsForDoor<T extends { id: string }>(categories: readonly T[], door: HubDoorFilter): T[] {
  if (door === 'all') return [...categories]
  const order = door === 'finance' ? FINANCE_CATEGORY_IDS : WORLD_CATEGORY_IDS
  const byId = new Map(categories.map((row) => [row.id, row]))
  const out: T[] = []
  for (const id of order) {
    const row = byId.get(id)
    if (row) out.push(row)
  }
  return out
}

export function categoryFromSearch(search: string, visibleIds: readonly string[]): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const id = canonicalCategoryParam(new URLSearchParams(raw).get('cat'))
  if (!id || !visibleIds.includes(id)) return null
  return id
}

export function parseStoredDoor(value: string | null): HubDoorFilter | null {
  if (value === 'finance' || value === 'world' || value === 'all') return value
  return null
}
