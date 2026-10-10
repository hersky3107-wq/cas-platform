import type { EngineCard, Hypothesis } from './schema'
import { zoneByKey, type ZoneKey } from '../zones'

export const ZONE_TOP_N = 8
export const ZONE_MIN_STAGE = 2

export interface ZoneMemberInput {
  regionId: number
  name: string
  country: string
  iso3: string | null
  stage: number
  score: number
  lat: number
  lon: number
  level: number
  card: EngineCard
}

export interface ZoneNeighborEdge {
  regionId: number
  neighborId: number
  sharedBorder: boolean
}

export interface RegionTag {
  region_id: number
  name: string
  iso3: string | null
}

export interface CrossBorderLink {
  title: string
  from_region: string
  to_region: string
  link: string
}

export function pickZoneMembers<T extends { iso3: string | null; stage: number; score: number }>(
  rows: T[],
  zoneKey: ZoneKey,
  isoOf: (row: T) => string | null = (row) => row.iso3,
): T[] {
  const zone = zoneByKey(zoneKey)
  if (!zone) return []
  const allowed = new Set(zone.iso3)
  return rows
    .filter((row) => {
      const iso = isoOf(row)
      return iso != null && allowed.has(iso) && row.stage >= ZONE_MIN_STAGE
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, ZONE_TOP_N)
}

export function combineZoneCard(opts: {
  zoneKey: ZoneKey
  members: ZoneMemberInput[]
  neighbors: ZoneNeighborEdge[]
  horizon: EngineCard['horizon']
}): EngineCard {
  const zone = zoneByKey(opts.zoneKey)
  if (!zone) throw new Error(`unknown zone ${opts.zoneKey}`)
  if (opts.members.length === 0) throw new Error(`no stage >= ${ZONE_MIN_STAGE} regions in ${opts.zoneKey}`)
  const byId = new Map(opts.members.map((row) => [row.regionId, row]))
  const names = (id: number) => byId.get(id)?.name ?? `#${id}`
  const neighborLines = opts.neighbors
    .filter((edge) => byId.has(edge.regionId) || byId.has(edge.neighborId))
    .map((edge) => `border ${names(edge.regionId)} — ${names(edge.neighborId)}${edge.sharedBorder ? ' (shared)' : ''}`)
  const memberLines = opts.members.map(
    (row) => `${row.name} (${row.iso3 ?? row.country}) stage ${row.stage} score ${row.score}`,
  )
  const lead = opts.members[0]
  const components = opts.members.flatMap((row) =>
    row.card.components.map((item) => ({ ...item, raw: { ...item.raw, region: row.name, iso3: row.iso3 } })),
  )
  const fragility = opts.members.flatMap((row) =>
    row.card.fragility.map((item) => ({ ...item, name: `${item.name} (${row.name})` })),
  )
  return {
    region_id: lead.regionId,
    name: zone.nameEn,
    country: zone.nameEn,
    iso3: null,
    lat: opts.members.reduce((sum, row) => sum + row.lat, 0) / opts.members.length,
    lon: opts.members.reduce((sum, row) => sum + row.lon, 0) / opts.members.length,
    level: 0,
    horizon: opts.horizon,
    components,
    fragility,
    cascades: opts.members.flatMap((row) => row.card.cascades),
    context: [
      `Zone ${zone.nameEn} (${zone.nameKo}). Look for cross-border links: upstream dam to a downstream country, conflict to refugee camps across the border, outbreak spread.`,
      ...memberLines,
      ...neighborLines,
    ],
    urban: opts.members.flatMap((row) => row.card.urban),
    zone_key: zone.key,
    members: opts.members.map((row) => ({
      region_id: row.regionId,
      name: row.name,
      country: row.country,
      iso3: row.iso3,
    })),
    neighbors: neighborLines,
  }
}

export function tagsForText(text: string, members: Array<{ region_id: number; name: string; iso3: string | null }>): RegionTag[] {
  const hay = text.toLowerCase()
  return members
    .filter((row) => row.name && hay.includes(row.name.toLowerCase()))
    .map((row) => ({ region_id: row.region_id, name: row.name, iso3: row.iso3 }))
}

export function crossBorderLinks(
  rows: Array<Pick<Hypothesis, 'title' | 'mechanism' | 'regions'>>,
  members: Array<{ region_id: number; name: string; iso3: string | null }>,
): CrossBorderLink[] {
  const out: CrossBorderLink[] = []
  for (const row of rows) {
    const tagged = row.regions && row.regions.length >= 2 ? row.regions : tagsForText(`${row.title} ${row.mechanism ?? ''}`, members)
    if (tagged.length < 2) continue
    out.push({
      title: row.title,
      from_region: tagged[0].name,
      to_region: tagged[1].name,
      link: row.mechanism?.trim() || row.title,
    })
  }
  return out
}
