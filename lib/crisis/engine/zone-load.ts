import type { SupabaseClient } from '@supabase/supabase-js'
import { engineCardFromStored } from '../admin/card'
import { loadFlagDetail, loadTodayRegions } from '../admin/store'
import { DEFAULT_HORIZON } from '../admin/types'
import { parseFlagDetail } from '../admin/today'
import { zoneByKey, type ZoneKey } from '../zones'
import type { EngineCard } from './schema'
import { combineZoneCard, type ZoneMemberInput, type ZoneNeighborEdge } from './zone-card'

export async function loadZoneEngineCard(
  client: SupabaseClient,
  zoneKey: ZoneKey,
  horizon: EngineCard['horizon'] = DEFAULT_HORIZON,
): Promise<EngineCard> {
  const zone = zoneByKey(zoneKey)
  if (!zone) throw new Error(`unknown zone ${zoneKey}`)
  const scored = await loadTodayRegions(client)
  const inZone = scored.regions.filter((row) => row.iso3 && zone.iso3.includes(row.iso3))
  const picked = [...inZone].filter((row) => row.stage >= 2).sort((a, b) => b.score - a.score).slice(0, 8)
  if (picked.length === 0) throw new Error(`no stage >= 2 regions in ${zoneKey}`)
  const members: ZoneMemberInput[] = []
  for (const region of picked) {
    const detail = parseFlagDetail(await loadFlagDetail(client, region.regionId, scored.day))
    members.push({
      regionId: region.regionId,
      name: region.name,
      country: region.country,
      iso3: region.iso3,
      stage: region.stage,
      score: region.score,
      lat: region.lat,
      lon: region.lon,
      level: region.level,
      card: engineCardFromStored(region, detail, horizon),
    })
  }
  const ids = members.map((row) => row.regionId)
  const { data, error } = await client.from('crisis_region_neighbors').select('region_id,neighbor_id,shared_border').in('region_id', ids)
  if (error) throw new Error(error.message)
  const zoneIds = new Set(inZone.map((row) => row.regionId))
  const neighbors: ZoneNeighborEdge[] = (data ?? [])
    .map((row) => ({
      regionId: Number(row.region_id),
      neighborId: Number(row.neighbor_id),
      sharedBorder: Boolean(row.shared_border),
    }))
    .filter((edge) => zoneIds.has(edge.neighborId))
  return combineZoneCard({ zoneKey, members, neighbors, horizon })
}
