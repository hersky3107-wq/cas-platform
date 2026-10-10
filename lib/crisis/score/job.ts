import type { SupabaseClient } from '@supabase/supabase-js'
import { cycloneCoversRegion, escalationValue, linkEvents } from '../events/link'
import { conflictShareEscalation } from './slowburn'
import { isConflictWatchlistIso3 } from '../config/watchlist'
import { buildAnomalyCard } from './card'
import { finalizeScore } from './compute'
import { damsNear, geographicKinds, nuclearNear, upstreamDamAdd } from './fragility'
import { naturalTitlesForCoast } from './basins'
import { amplifyFired } from './wiki-amplifier'
import { vectorDiseaseContext } from './vector-watch'
import { printTop30 } from './print'
import { calibrationReport } from './report'
import { loadSlowBurn } from './slowburn-load'
import { enrichTriggerComponents } from './trigger-meta'
import { loadScoreSnapshot, oilContextLine, watchlistIso3 } from './snapshot'
import { isOilDependentIso3 } from '../config/oil'
import { COMPONENT_FAMILY, CYCLONE, SCORE_SCHEDULE_MINUTES, SCORE_SOURCE } from './thresholds'
import {
  advisoryComponent,
  conflictAbsCut,
  conflictComponent,
  conflictGeoQuality,
  cycloneComponent,
  fireComponent,
  fireCuts,
  foodComponent,
  gdacsComponent,
  internetComponent,
  internetRaw,
  observedRainAdjust,
  quakeComponent,
  rainComponent,
  riverComponent,
  silenceComponent,
  volcanoComponent,
  escalationComponent,
  healthAttentionComponent,
  slowBurnComponent,
} from './trigger'
import type { RegionScore } from './types'
import { haversineKm } from './math'
import { applyEarthquakePrecursor, applyVolcanoPrecursor } from '../precursors/apply'
import {
  bValueDrop,
  dedupeQuakes,
  flagNear,
  rateFlags,
  swarmClusters,
  swarmNear,
  type QuakePoint,
} from '../precursors/earthquake'
import { hazardZoneFromPlateKm, isCoastalKm, nearestKm } from '../precursors/geometry'
import { coastIndex, plateIndex } from '../precursors/geometry-load'
import { volcanoPrecursors } from '../precursors/volcano'

export interface ScoreJobResult {
  day: string
  scored: number
  cards: number
  neighborSource: string
  top30: string
  rows: RegionScore[]
}

export async function runLayer1Score(
  client: SupabaseClient,
  opts: { dryRun: boolean; write?: boolean; touchSchedule?: boolean; now?: Date; log?: (message: string) => void; precursors?: boolean },
): Promise<ScoreJobResult> {
  const now = opts.now ?? new Date()
  const log = opts.log ?? ((message: string) => console.log(message))
  const snap = await loadScoreSnapshot(client, now)
  const precursorsOn = opts.precursors !== false
  const quakePoints: QuakePoint[] = dedupeQuakes(
    snap.quakes.map((row) => ({
      lat: row.lat,
      lon: row.lon,
      mag: row.mag,
      at: row.event_time,
    })),
  )
  const rateCells = precursorsOn ? rateFlags(quakePoints, snap.precursors.yearCounts, now) : []
  const swarms = precursorsOn ? swarmClusters(quakePoints, now) : []
  const plates = precursorsOn ? plateIndex() : null
  const coasts = precursorsOn ? coastIndex() : null
  const coastalByRegion = new Map<number, boolean>()
  if (precursorsOn) {
    log(`precursors rate_cells=${rateCells.length} swarms=${swarms.length} holocene=${snap.precursors.holocene.length} background_cells=${snap.precursors.yearCounts.size} oaf=${snap.precursors.oaf.length}`)
  }
  const frpCut = fireCuts(snap.frpByRegion)
  const absCut = conflictAbsCut(snap.conflictCounts)
  const nowYear = now.getUTCFullYear()
  const day = snap.day
  const countryCentroid = new Map<string, { lat: number; lon: number }>()
  for (const row of snap.regions) {
    if (row.level === 0 && row.iso3) countryCentroid.set(row.iso3, { lat: row.lat, lon: row.lon })
  }

  const triggerByRegion = new Map<number, ReturnType<typeof rainComponent>[]>()
  const naturalTitleByRegion = new Map<number, string>()
  const linked = linkEvents(snap.observations, now)
  const burn = await loadSlowBurn(client, now, snap.regions, snap.neighbors)
  log(`slow-burn source=${burn.source} countries=${burn.countries.length} dyads=${burn.dyads.length}`)
  for (const row of burn.countries.slice(0, 20)) {
    log(`slow-burn country ${row.name} ${row.id} value=${row.value} kind=${row.kind} ${row.note}`)
  }
  for (const row of burn.dyads.slice(0, 20)) {
    log(`slow-burn dyad ${row.name} value=${row.value} kind=${row.kind} ${row.note}`)
  }

  const countryShareEscByIso = new Map<string, { value: number; raw: Record<string, unknown> }>()
  for (const r of snap.regions) {
    if (r.level === 0 && r.iso3) {
      const inp = snap.inputs.get(r.id)
      if (inp && inp.gdeltSeries.length > 0) {
        const esc = conflictShareEscalation(inp.gdeltSeries, now)
        if (esc.value > 0) countryShareEscByIso.set(r.iso3, esc)
      }
    }
  }

  for (const region of snap.regions) {
    const input = snap.inputs.get(region.id)
    if (!input) continue
    const wiki = region.iso3 ? snap.wikiByIso.get(region.iso3) : undefined
    const naturalTitles = naturalTitlesForCoast(wiki?.natural ?? [], region.lat, region.lon)
    if (naturalTitles[0]) naturalTitleByRegion.set(region.id, naturalTitles[0])

    let internet = internetComponent(input.internet, internetRaw(input.internetSources))
    if (region.level === 1 && internet.value > 0 && !input.regionSpecificInternet) {
      internet = {
        ...internet,
        value: internet.value * 0.5,
        raw: { ...internet.raw, country_weight: 0.5 },
      }
    }

    let advisory = advisoryComponent({ changed: input.advisoryChange, diverge: input.advisoryDiverge })
    if (region.level === 1 && advisory.value > 0 && !input.regionSpecificAdvisory) {
      advisory = {
        ...advisory,
        value: advisory.value * 0.5,
        raw: { ...advisory.raw, country_weight: 0.5 },
      }
    }

    const hazardZone = plates ? hazardZoneFromPlateKm(nearestKm(plates, region.lat, region.lon, 4)) : 0.35
    const coastal = coasts ? isCoastalKm(nearestKm(coasts, region.lat, region.lon, 2)) : false
    coastalByRegion.set(region.id, coastal)
    const recentMags = quakePoints
      .filter((row) => {
        const t = row.at ? Date.parse(row.at) : NaN
        return haversineKm(region.lat, region.lon, row.lat, row.lon) <= 50 && (!Number.isFinite(t) || t >= now.getTime() - 72 * 3_600_000)
      })
      .map((row) => row.mag)
    const olderMags = quakePoints
      .filter((row) => {
        const t = row.at ? Date.parse(row.at) : NaN
        return haversineKm(region.lat, region.lon, row.lat, row.lon) <= 50 && Number.isFinite(t) && t < now.getTime() - 72 * 3_600_000
      })
      .map((row) => row.mag)
    const oafHit = precursorsOn
      ? snap.precursors.oaf
          .map((row) => ({ row, km: haversineKm(region.lat, region.lon, row.lat, row.lon) }))
          .filter((row) => row.km <= 150)
          .sort((a, b) => a.km - b.km)[0]?.row ?? null
      : null
    const quake = precursorsOn
      ? applyEarthquakePrecursor(quakeComponent(region.lat, region.lon, now, snap.quakes), {
          flag: flagNear(region.lat, region.lon, rateCells),
          hazardZone,
          swarm: swarmNear(region.lat, region.lon, swarms),
          bDrop: bValueDrop(recentMags, olderMags),
          oaf: oafHit ? { m5: oafHit.m5, m6: oafHit.m6, m7: oafHit.m7 } : null,
        })
      : quakeComponent(region.lat, region.lon, now, snap.quakes)
    const volcanoBase = volcanoComponent(region.lat, region.lon, now, snap.volcanoes)
    const volcano = precursorsOn
      ? applyVolcanoPrecursor(
          volcanoBase,
          volcanoPrecursors({
            lat: region.lat,
            lon: region.lon,
            now,
            volcanoes: snap.precursors.holocene,
            quakes: quakePoints,
            yearCounts: snap.precursors.yearCounts,
            points: snap.precursors.points,
          }),
        )
      : volcanoBase

    let components = [
      observedRainAdjust(rainComponent(input.precip), input.observedRain),
      riverComponent({
        discharge: input.discharge,
        ratioTo30d: input.ratioTo30d,
        historyDays: input.glofasDays,
      }),
      cycloneComponent(region.lat, region.lon, now, snap.cyclones),
      quake,
      gdacsComponent(region.lat, region.lon, region.id, region.iso3, now, snap.gdacs),
      volcano,
      fireComponent({
        frpSum: input.frpSum,
        count: input.frpCount,
        top1Cut: frpCut,
        watchlist: watchlistIso3(region.iso3),
      }),
      conflictComponent({
        conflictCount: input.conflictCount,
        mean30d: input.conflictMean,
        historyDays: input.conflictDays,
        absCut,
        geo: conflictGeoQuality({
          level: region.level,
          lat: region.lat,
          lon: region.lon,
          countryLat: region.iso3 ? countryCentroid.get(region.iso3)?.lat : null,
          countryLon: region.iso3 ? countryCentroid.get(region.iso3)?.lon : null,
        }),
      }),
      silenceComponent({
        series: input.gdeltSeries,
        now,
      }),
      internet,
      advisory,
      foodComponent(input.ipc),
    ]
    const humanFired = components.some((row) =>
      COMPONENT_FAMILY[row.key] === 'human' && row.value > 0 && row.key !== 'health_attention' && row.key !== 'slow_burn',
    )
    components = amplifyFired(components, {
      natural: naturalTitles.length > 0,
      human: Boolean(wiki?.human.length) && humanFired,
    })
    if (region.level === 0 && wiki?.health.length) {
      components = [...components, healthAttentionComponent(true, wiki.health[0])]
    }
    const neighborIds = snap.neighbors.get(region.id) ?? []
    const covered = new Set([region.id, ...neighborIds])
    const pace = linked
      .filter((event) => {
        if (event.kind === 'conflict') return false
        if (event.kind === 'cyclone') return cycloneCoversRegion(event.track, region.lat, region.lon, CYCLONE.nearKm)
        return event.region_ids.some((id) => covered.has(id))
      })
      .sort((a, b) => escalationValue(b.pace) - escalationValue(a.pace))[0]
    const shareEsc = conflictShareEscalation(input.gdeltSeries, now)
    if (shareEsc.value > 0) {
      components = [...components, escalationComponent(shareEsc.value, shareEsc.raw)]
    } else if (pace && escalationValue(pace.pace) > 0) {
      let escVal = escalationValue(pace.pace)
      let escRaw: Record<string, unknown> = { event: pace.id, pace: pace.pace }
      const touchesThisRegion = (pace.region_ids ?? []).includes(region.id)
      if (region.level === 1 && !touchesThisRegion) {
        escVal = escVal * 0.5
        escRaw = { ...escRaw, country_weight: 0.5 }
      }
      components = [...components, escalationComponent(escVal, escRaw)]
    } else if (region.level === 1 && region.iso3 && countryShareEscByIso.has(region.iso3)) {
      const cEsc = countryShareEscByIso.get(region.iso3)!
      components = [...components, escalationComponent(cEsc.value * 0.5, { ...cEsc.raw, country_weight: 0.5 })]
    }
    const hit = burn.byRegion.get(region.id)
    if (hit && hit.value > 0) {
      let sbValue = hit.value
      let sbRaw: Record<string, unknown> = { ...hit.detail }
      if (region.level === 1 && !burn.regionSpecific?.has(region.id)) {
        sbValue = hit.value * 0.5
        sbRaw = { ...sbRaw, country_weight: 0.5 }
      }
      components = [...components, slowBurnComponent(sbValue, sbRaw)]
    }
    triggerByRegion.set(region.id, components)
  }

  const rows: RegionScore[] = []
  for (const region of snap.regions) {
    const input = snap.inputs.get(region.id)
    const components = triggerByRegion.get(region.id)
    if (!input || !components) continue
    const neighborIds = snap.neighbors.get(region.id) ?? []
    const damItems = damsNear(region.lat, region.lon, region.id, snap.dams, nowYear)
    const campHere = snap.camps.filter((camp) => camp.region_id === region.id)
    const nuclearItems = nuclearNear(region.lat, region.lon, region.id, snap.plants, components)
    const kinds = geographicKinds(region.id, neighborIds, snap.dams, snap.camps, snap.plants)
    const upstream = upstreamDamAdd(neighborIds, triggerByRegion, snap.dams)
    const wiki = region.iso3 ? snap.wikiByIso.get(region.iso3) : undefined
    const context: string[] = []
    const naturalAmp = components.some((row) => COMPONENT_FAMILY[row.key] === 'natural' && row.raw.wiki_amplify)
    const naturalTitle = naturalTitleByRegion.get(region.id)
    if (naturalAmp && naturalTitle) context.push(`wiki: ${naturalTitle}`)
    const humanAmp = components.some((row) => COMPONENT_FAMILY[row.key] === 'human' && row.raw.wiki_amplify)
    if (humanAmp && wiki?.human[0]) context.push(`wiki: ${wiki.human[0]}`)
    if (region.level === 0 && wiki?.health[0]) context.push(`wiki: ${wiki.health[0]}`)
    const floodOrDrought = components.some((row) => (row.key === 'rain' || row.key === 'river' || row.key === 'food') && row.value > 0)
    if (snap.enso && floodOrDrought) {
      context.push(`enso: ${snap.enso.status}${snap.enso.anomaly == null ? '' : ` nino34 ${snap.enso.anomaly}`}`)
    }
    const vector = vectorDiseaseContext(snap.rainDays.get(region.id) ?? [], now)
    if (vector) context.push(vector)
    const oilLine = isConflictWatchlistIso3(region.iso3) || isOilDependentIso3(region.iso3) ? oilContextLine(snap.oil) : null
    if (oilLine) context.push(oilLine)
    const extra = snap.plants
      .filter((plant) => plant.region_id === region.id && (plant.kind === 'chemical_plant' || plant.kind === 'port'))
      .slice(0, 3)
      .map((plant) => ({
        kind: plant.kind ?? 'port',
        name: plant.name,
        lat: plant.lat,
        lon: plant.lon,
        weight: 0.2,
        attributes: {},
      }))
    const storedComponents = enrichTriggerComponents(components, {
      now,
      lat: region.lat,
      lon: region.lon,
      precip: input.precip,
      discharge: input.discharge,
      cycloneTracks: snap.cyclones,
    })
    const scored = finalizeScore({
      region_id: region.id,
      name: region.name,
      country: region.country,
      iso3: region.iso3,
      urban_pop: input.urbanPop,
      inform_exposure: input.informExposure,
      inform_vulnerability: input.informVulnerability,
      inform_coping: input.informCoping,
      components: storedComponents,
      dam_items: damItems,
      camp_count: campHere.length,
      nuclear_items: nuclearItems,
      upstream_add: upstream,
      urban_centres: input.centres,
      kinds,
      watchlist: isConflictWatchlistIso3(region.iso3),
      context,
      extra_items: extra,
      coastal: coastalByRegion.get(region.id) === true,
    })
    rows.push({ ...scored, lat: region.lat, lon: region.lon, level: region.level })
  }

  const top30 = printTop30(rows)
  const report = calibrationReport(rows, {
    riverFired: rows.filter((row) => row.components.some((component) => component.key === 'river')).length,
    advisoryBoth: snap.advisoryBoth,
    advisoryDiverge: snap.advisoryDiverge,
    wikiKept: snap.wikiKept.length,
    wikiDropped: snap.wikiDropped.length,
    wikiKeptExamples: snap.wikiKept,
    wikiDroppedExamples: snap.wikiDropped,
    wikiRelated: rows.filter((row) =>
      row.components.some((component) => component.key === 'health_attention') ||
      row.context.some((line) => line.startsWith('wiki:')),
    ).length,
  })
  log(`score day=${day} regions=${rows.length} neighbors=${snap.neighborSource}`)
  log(report)
  log(top30)

  const write = opts.write === true && !opts.dryRun
  const schedulePatch = async (markSuccess: boolean) => {
    const patch: Record<string, unknown> = {
      source: SCORE_SOURCE,
      next_due_at: new Date(now.getTime() + SCORE_SCHEDULE_MINUTES * 60_000).toISOString(),
    }
    if (markSuccess) patch.last_success_at = now.toISOString()
    await client.from('crisis_ingest_state').upsert(patch, { onConflict: 'source' })
  }
  if (!write) {
    if (opts.touchSchedule) await schedulePatch(false)
    return { day, scored: rows.length, cards: rows.filter((row) => row.stage >= 2).length, neighborSource: snap.neighborSource, top30, rows }
  }

  const flags: Array<{ region_id: number; flag_date: string; flag: string; value: number; detail: unknown }> = []
  for (const row of rows) {
    flags.push({
      region_id: row.region_id,
      flag_date: day,
      flag: 'risk_score',
      value: row.score,
      detail: {
        stage: row.stage,
        trigger: row.trigger,
        fragility: row.fragility,
        people_norm: row.people_norm,
        raw_score: row.raw_score,
        bonus: row.bonus,
        components: row.components,
        fragility_items: row.fragility_items,
        cascades: row.cascades,
        departments: row.departments,
      },
    })
    const slow = row.components.find((component) => component.key === 'slow_burn' && component.value > 0)
    if (slow) {
      flags.push({
        region_id: row.region_id,
        flag_date: day,
        flag: 'slow_burn',
        value: slow.value,
        detail: slow.raw,
      })
    }
    if (row.stage >= 2) {
      const card = buildAnomalyCard(row, snap.signalsByRegion.get(row.region_id) ?? [])
      flags.push({
        region_id: row.region_id,
        flag_date: day,
        flag: 'anomaly_card',
        value: row.score,
        detail: card,
      })
    }
  }

  const chunk = 200
  for (let i = 0; i < flags.length; i += chunk) {
    const { error } = await client.from('crisis_region_flags').upsert(flags.slice(i, i + chunk), {
      onConflict: 'region_id,flag_date,flag',
    })
    if (error) throw new Error(`crisis_region_flags: ${error.message}`)
  }
  log(`wrote ${flags.length} flags`)
  if (linked.length) {
    const { error } = await client.from('crisis_events').upsert(linked.map((event) => ({
      id: event.id,
      kind: event.kind,
      name: event.name,
      first_seen: event.first_seen,
      last_seen: event.last_seen,
      region_ids: event.region_ids,
      metrics_history: event.metrics_history,
      status: event.status,
      source_refs: event.source_refs,
    })), { onConflict: 'id' })
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      throw new Error(`crisis_events: ${error.message}`)
    }
    if (error) log('crisis_events table is not applied yet')
  }
  await schedulePatch(true)

  return {
    day,
    scored: rows.length,
    cards: flags.filter((row) => row.flag === 'anomaly_card').length,
    neighborSource: snap.neighborSource,
    top30,
    rows,
  }
}

