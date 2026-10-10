import type { EngineCard, Hypothesis } from './schema'

import { regionStormBasins, type StormBasin } from '../score/basins'

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



export type ZoneLinkDropReason =

  | 'fewer_than_two_regions'

  | 'not_neighbors'

  | 'no_shared_hydro'

  | 'no_movement_path'

  | 'returnee_without_grounding'



export interface ZoneLinkRowInput extends Pick<Hypothesis, 'title' | 'mechanism' | 'regions'> {

  evidence?: Array<{ type?: string; ref?: string; url?: string }>

  why_humans_miss?: string

  entities?: string[]

  chain?: Array<{ step?: string }>

}



export interface ZoneLinkBuildOpts {

  members: Array<{ region_id: number; name: string; iso3: string | null; lat?: number; lon?: number }>

  neighborEdges: ZoneNeighborEdge[]

  hydroNames: string[]

  log?: (message: string) => void

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

      lat: row.lat,

      lon: row.lon,

    })),

    neighbor_edges: opts.neighbors,

    neighbors: neighborLines,

  }

}



export function tagsForText(text: string, members: Array<{ region_id: number; name: string; iso3: string | null }>): RegionTag[] {

  const hay = text.toLowerCase()

  return members

    .filter((row) => row.name && hay.includes(row.name.toLowerCase()))

    .map((row) => ({ region_id: row.region_id, name: row.name, iso3: row.iso3 }))

}



function regionsAreNeighbors(a: number, b: number, edges: ZoneNeighborEdge[]): boolean {

  return edges.some(

    (edge) => (edge.regionId === a && edge.neighborId === b) || (edge.regionId === b && edge.neighborId === a),

  )

}



function sharedStormBasin(

  a: { lat?: number; lon?: number },

  b: { lat?: number; lon?: number },

): StormBasin | null {

  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null

  const left = regionStormBasins(a.lat, a.lon)

  const right = regionStormBasins(b.lat, b.lon)

  return left.find((basin) => right.includes(basin)) ?? null

}



function linkCorpus(row: ZoneLinkRowInput): string {

  const bits = [

    row.title,

    row.mechanism ?? '',

    row.why_humans_miss ?? '',

    ...(row.entities ?? []),

    ...(row.chain ?? []).map((step) => step.step ?? ''),

    ...(row.evidence ?? []).map((item) => `${item.type ?? ''} ${item.ref ?? ''}`),

  ]

  return bits.join(' ').replace(/\s+/g, ' ').trim()

}



function hydroMentioned(text: string, hydroNames: string[]): boolean {

  if (/\b(river|dam|reservoir|basin|upstream|downstream|tributary|spillway|levee|floodplain)\b/i.test(text)) {

    return true

  }

  const lower = text.toLowerCase()

  return hydroNames.some((name) => name.length > 3 && lower.includes(name.toLowerCase()))

}



function movementPathNamed(text: string, from: string, to: string): boolean {

  const lower = text.toLowerCase()

  const a = from.toLowerCase()

  const b = to.toLowerCase()

  if (!lower.includes(a) || !lower.includes(b)) return false

  if (/\breturnees?\b/i.test(text) && !/\b(border|river|corridor|downstream|upstream|cross(es|ing)?)\b/i.test(text)) {

    return false

  }

  return /\b(cross(es|ing)?|downstream|upstream|along the|spill(s|over)?|flee(s|ing)?|displaced|refugees? (cross|flee|into)|spread(s|ing)? into|river corridor|border)\b/i.test(

    text,

  )

}



export function zoneLinkKeepReason(

  tagged: RegionTag[],

  row: ZoneLinkRowInput,

  opts: ZoneLinkBuildOpts,

): ZoneLinkDropReason | null {

  if (tagged.length < 2) return 'fewer_than_two_regions'

  const byId = new Map(opts.members.map((member) => [member.region_id, member]))

  const a = byId.get(tagged[0].region_id)

  const b = byId.get(tagged[1].region_id)

  if (!a || !b) return 'fewer_than_two_regions'

  const text = linkCorpus(row)

  if (regionsAreNeighbors(a.region_id, b.region_id, opts.neighborEdges)) return null

  const basin = sharedStormBasin(a, b)

  if (basin && hydroMentioned(text, opts.hydroNames)) return null

  if (namedHydroPair(text, opts.hydroNames)) return null

  if (movementPathNamed(text, a.name, b.name)) return null

  if (/\breturnees?\b/i.test(text)) return 'returnee_without_grounding'

  if (!basin && !hydroMentioned(text, opts.hydroNames)) return 'no_shared_hydro'

  return 'no_movement_path'

}



function namedHydroPair(text: string, hydroNames: string[]): boolean {

  const lower = text.toLowerCase()

  return hydroNames.filter((name) => name.length > 3 && lower.includes(name.toLowerCase())).length >= 1

}



export function buildZoneLinks(

  rows: ZoneLinkRowInput[],

  opts: ZoneLinkBuildOpts,

): { cross_border: CrossBorderLink[]; intra_zone: CrossBorderLink[] } {

  const cross_border: CrossBorderLink[] = []

  const intra_zone: CrossBorderLink[] = []

  const log = opts.log ?? ((message: string) => console.warn(message))

  const isoOf = (id: number) => opts.members.find((row) => row.region_id === id)?.iso3 ?? null



  for (const row of rows) {

    const tagged =

      row.regions && row.regions.length >= 2

        ? row.regions

        : tagsForText(`${row.title} ${row.mechanism ?? ''}`, opts.members)

    if (tagged.length < 2) continue

    const pair = tagged.slice(0, 2)

    const drop = zoneLinkKeepReason(pair, row, opts)

    if (drop) {

      log(`zone link dropped (${drop}): ${pair[0].name} → ${pair[1].name} · ${row.title}`)

      continue

    }

    const link: CrossBorderLink = {

      title: row.title,

      from_region: pair[0].name,

      to_region: pair[1].name,

      link: row.mechanism?.trim() || row.title,

    }

    const leftIso = isoOf(pair[0].region_id) ?? pair[0].iso3

    const rightIso = isoOf(pair[1].region_id) ?? pair[1].iso3

    if (leftIso && rightIso && leftIso === rightIso) intra_zone.push(link)

    else cross_border.push(link)

  }

  return { cross_border, intra_zone }

}



/** @deprecated use buildZoneLinks */

export function crossBorderLinks(

  rows: Array<Pick<Hypothesis, 'title' | 'mechanism' | 'regions'>>,

  members: Array<{ region_id: number; name: string; iso3: string | null }>,

): CrossBorderLink[] {

  return buildZoneLinks(rows, { members, neighborEdges: [], hydroNames: [] }).cross_border

}


