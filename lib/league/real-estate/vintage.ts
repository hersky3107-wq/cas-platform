/**
 * First published value is the grading vintage. A later different number is a
 * revision and never replaces the first row.
 */

export type IncomingPrint = {
  refPeriod: string
  value: number
}

export type VintageWrite =
  | { kind: 'first'; refPeriod: string; value: number; seenAt: string }
  | { kind: 'revision'; refPeriod: string; value: number; seenAt: string }

export function planVintageWrites(
  existingFirst: ReadonlyMap<string, number>,
  incoming: readonly IncomingPrint[],
  seenAt: string,
): VintageWrite[] {
  const writes: VintageWrite[] = []
  const seen = new Set<string>()
  for (const row of incoming) {
    if (!row.refPeriod || !Number.isFinite(row.value) || seen.has(row.refPeriod)) continue
    seen.add(row.refPeriod)
    const first = existingFirst.get(row.refPeriod)
    if (first == null) {
      writes.push({ kind: 'first', refPeriod: row.refPeriod, value: row.value, seenAt })
      continue
    }
    if (first !== row.value) {
      writes.push({ kind: 'revision', refPeriod: row.refPeriod, value: row.value, seenAt })
    }
  }
  return writes
}

export function priorPeriod(refPeriod: string, cadence: 'month' | 'quarter'): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(refPeriod)
  if (!match) return null
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) - (cadence === 'quarter' ? 3 : 1)
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}
