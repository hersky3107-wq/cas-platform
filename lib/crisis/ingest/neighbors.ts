/** One statement covers one country, or a slice of at most this many admin1 regions. */
export const NEIGHBOR_BATCH_SIZE = 200

export interface NeighborRegionRef {
  id: number
  iso3: string | null
  level: number
}

export interface NeighborBatch {
  key: string
  iso3: string
  ids: number[]
}

/**
 * Group admin1 by country, then split any country larger than `size`.
 * Keys are stable so a resumed run can skip `cursor.completed`.
 * Cross-border pairs are the SQL function's job: each batch is joined to every other admin1.
 */
export function planNeighborBatches(regions: NeighborRegionRef[], size = NEIGHBOR_BATCH_SIZE): NeighborBatch[] {
  if (size < 1 || size > NEIGHBOR_BATCH_SIZE) {
    throw new Error(`neighbor batch size must be 1..${NEIGHBOR_BATCH_SIZE}`)
  }
  const byIso = new Map<string, number[]>()
  for (const region of regions) {
    if (region.level !== 1) continue
    const iso3 = region.iso3 ?? 'UNK'
    const list = byIso.get(iso3) ?? []
    list.push(region.id)
    byIso.set(iso3, list)
  }
  const batches: NeighborBatch[] = []
  for (const iso3 of [...byIso.keys()].sort()) {
    const ids = [...(byIso.get(iso3) ?? [])].sort((a, b) => a - b)
    for (let offset = 0; offset < ids.length; offset += size) {
      const slice = ids.slice(offset, offset + size)
      const part = Math.floor(offset / size)
      batches.push({ key: `${iso3}:${part}`, iso3, ids: slice })
    }
  }
  return batches
}

export function pendingNeighborBatches(batches: NeighborBatch[], completed: readonly string[]): NeighborBatch[] {
  const done = new Set(completed)
  return batches.filter((batch) => !done.has(batch.key))
}
