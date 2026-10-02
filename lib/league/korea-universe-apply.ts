/**
 * Pure planner for applying a KRX (or US) popularity snapshot onto
 * `league_kr_universe`. No network / DB — the script supplies rows.
 *
 * Never deletes. Never changes pinned/hidden status. Unmapped KR codes
 * land in group `other`.
 */

import {
  decideUniverseStatus,
  isKrGroupId,
  type KrGroupId,
  type UniverseMarket,
  type UniverseRow,
  type UniverseStatus,
} from './korea-equity-catalog'

export type UniverseRecord = {
  market: UniverseMarket
  code: string
  name: string
  groupId: KrGroupId | null
  status: UniverseStatus
  popularityRank: number | null
  avgTrdval20dEok: number | null
  mktcapEok: number | null
  visible: boolean
  removedAt: string | null
  flags: string[]
  updatedAt: string
}

export type UniverseSnapshotRow = {
  market: UniverseMarket
  code: string
  name: string
  rank: number
  avgTrdval20dEok: number
  mktcapEok: number
}

export type KrGroupMapEntry = { group: string; flags?: string[] }
export type KrGroupMap = Record<string, KrGroupMapEntry>

export type UniverseApplyPlan = {
  writes: UniverseRecord[]
  entering: UniverseRecord[]
  staying: UniverseRecord[]
  leaving: UniverseRecord[]
  unmapped: string[]
  /** Map key present but `group` is not a KR_GROUPS id (coerced to other). */
  invalidGroups: string[]
}

export function universeMapKey(market: UniverseMarket, code: string): string {
  return `${market}:${code}`
}

export function parseKrGroupMap(raw: unknown): KrGroupMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: KrGroupMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const rec = value as Record<string, unknown>
    const group = typeof rec.group === 'string' ? rec.group : ''
    const flags = Array.isArray(rec.flags)
      ? rec.flags.filter((f): f is string => typeof f === 'string')
      : undefined
    out[key] = flags ? { group, flags } : { group }
  }
  return out
}

/**
 * `decideUniverseStatus` treats `removedAt === null` as currently visible.
 * Never-entered auto rows are stored as visible=false + removedAt=null, so
 * they must be passed as `undefined` (same as a brand-new code).
 */
export function hysteresisPrev(existing: UniverseRecord | undefined): UniverseRow | undefined {
  if (!existing) return undefined
  if (existing.status === 'auto' && !existing.visible && existing.removedAt == null) {
    return undefined
  }
  return {
    code: existing.code,
    name: existing.name,
    market: existing.market,
    groupId: existing.groupId,
    status: existing.status,
    popularityRank: existing.popularityRank,
    removedAt: existing.visible ? null : existing.removedAt,
  }
}

function resolveGroup(
  market: UniverseMarket,
  code: string,
  map: KrGroupMap,
): { groupId: KrGroupId | null; flags: string[] | undefined; unmapped: boolean; invalidGroup: boolean } {
  const entry = map[universeMapKey(market, code)]
  if (market === 'US') {
    return { groupId: null, flags: entry?.flags, unmapped: false, invalidGroup: false }
  }
  if (!entry) {
    return { groupId: 'other', flags: undefined, unmapped: true, invalidGroup: false }
  }
  if (!isKrGroupId(entry.group)) {
    return { groupId: 'other', flags: entry.flags, unmapped: false, invalidGroup: true }
  }
  return { groupId: entry.group, flags: entry.flags, unmapped: false, invalidGroup: false }
}

export function planUniverseApply(input: {
  existing: UniverseRecord[]
  snapshot: UniverseSnapshotRow[]
  groupMap: KrGroupMap
  now: string
}): UniverseApplyPlan {
  const existingByKey = new Map(input.existing.map((row) => [universeMapKey(row.market, row.code), row]))
  const snapshotByKey = new Map(input.snapshot.map((row) => [universeMapKey(row.market, row.code), row]))
  const keys = new Set([...existingByKey.keys(), ...snapshotByKey.keys()])

  const writes: UniverseRecord[] = []
  const entering: UniverseRecord[] = []
  const staying: UniverseRecord[] = []
  const leaving: UniverseRecord[] = []
  const unmapped: string[] = []
  const invalidGroups: string[] = []

  for (const key of [...keys].sort()) {
    const existing = existingByKey.get(key)
    const snap = snapshotByKey.get(key)
    const market = snap?.market ?? existing!.market
    const code = snap?.code ?? existing!.code
    const resolved = resolveGroup(market, code, input.groupMap)
    if (resolved.unmapped) unmapped.push(key)
    if (resolved.invalidGroup) invalidGroups.push(key)

    const status: UniverseStatus = existing?.status ?? 'auto'
    const next: UniverseRecord = {
      market,
      code,
      name: snap?.name ?? existing?.name ?? code,
      groupId: resolved.groupId,
      status,
      popularityRank: snap?.rank ?? null,
      avgTrdval20dEok: snap?.avgTrdval20dEok ?? existing?.avgTrdval20dEok ?? null,
      mktcapEok: snap?.mktcapEok ?? existing?.mktcapEok ?? null,
      visible: existing?.visible ?? false,
      removedAt: existing?.removedAt ?? null,
      flags: resolved.flags ?? existing?.flags ?? [],
      updatedAt: input.now,
    }

    const decision = decideUniverseStatus(hysteresisPrev(existing ? { ...existing, status } : undefined), snap?.rank ?? null, false, input.now)
    next.visible = decision.visible
    next.removedAt = decision.removedAt

    writes.push(next)
    const wasVisible = existing?.visible === true
    if (decision.visible && !wasVisible) entering.push(next)
    else if (decision.visible && wasVisible) staying.push(next)
    else if (!decision.visible && wasVisible) leaving.push(next)
  }

  return { writes, entering, staying, leaving, unmapped, invalidGroups }
}

export type LeagueKrUniverseDbRow = {
  market: string
  code: string
  name: string
  group_id: string | null
  status: string
  popularity_rank: number | null
  avg_trdval_20d_eok: number | null
  mktcap_eok: number | null
  visible: boolean
  removed_at: string | null
  flags: string[] | null
  updated_at: string
}

function asMarket(value: string): UniverseMarket | null {
  if (value === 'KOSPI' || value === 'KOSDAQ' || value === 'US') return value
  return null
}

function asStatus(value: string | null | undefined): UniverseStatus {
  if (value === 'pinned' || value === 'hidden' || value === 'auto') return value
  return 'auto'
}

export function mapUniverseDbRow(row: LeagueKrUniverseDbRow): UniverseRecord | null {
  const market = asMarket(row.market)
  if (!market) return null
  const groupId =
    row.group_id && isKrGroupId(row.group_id) ? row.group_id : market === 'US' ? null : 'other'
  return {
    market,
    code: row.code,
    name: row.name,
    groupId,
    status: asStatus(row.status),
    popularityRank: row.popularity_rank,
    avgTrdval20dEok: row.avg_trdval_20d_eok,
    mktcapEok: row.mktcap_eok,
    visible: row.visible,
    removedAt: row.removed_at,
    flags: Array.isArray(row.flags) ? row.flags : [],
    updatedAt: row.updated_at,
  }
}

export function toUniverseDbWrite(row: UniverseRecord): LeagueKrUniverseDbRow {
  return {
    market: row.market,
    code: row.code,
    name: row.name,
    group_id: row.groupId,
    status: row.status,
    popularity_rank: row.popularityRank,
    avg_trdval_20d_eok: row.avgTrdval20dEok,
    mktcap_eok: row.mktcapEok,
    visible: row.visible,
    removed_at: row.removedAt,
    flags: row.flags,
    updated_at: row.updatedAt,
  }
}
