import type { PublicCategoryId } from './catalog'

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
] as const satisfies readonly PublicCategoryId[]

export type HubDoor = 'finance' | 'world'
export type HubDoorFilter = HubDoor | 'all'

export const HUB_DOOR_STORAGE_KEY = 'league.hub.door'

export function doorForCategory(id: string): HubDoor | null {
  if ((FINANCE_CATEGORY_IDS as readonly string[]).includes(id)) return 'finance'
  if ((WORLD_CATEGORY_IDS as readonly string[]).includes(id)) return 'world'
  return null
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
  const id = new URLSearchParams(raw).get('cat')
  if (!id || !visibleIds.includes(id)) return null
  return id
}

export function parseStoredDoor(value: string | null): HubDoorFilter | null {
  if (value === 'finance' || value === 'world' || value === 'all') return value
  return null
}
