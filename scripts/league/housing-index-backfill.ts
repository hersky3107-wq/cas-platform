/**
 * Store official housing-index history for catalog regions.
 *
 * Dry-run makes no network request and prints whether each key is set.
 * It never prints the key itself.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/housing-index-backfill.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/housing-index-backfill.ts --apply
 *
 * Apply refuses to run while a league generation job is queued or running.
 * Apply the SQL in supabase/migrations/20261005000005_league_housing_index_prints.sql first.
 */
import { PROPERTY_REGIONS } from '@/lib/league/gateway/adapters/real-estate-regions'
import {
  fetchEstatHousing,
  fetchFredSeries,
  fetchMlitHousing,
  fetchRoneTable,
  fetchUkHpi,
  fredSeriesForRegion,
  pointsForArea,
  RONE_MONTHLY_STATBL,
  RONE_SIGUNGU_STATBL,
  RONE_WEEKLY_STATBL,
  roneTableForRegion,
  type HousingFetchResult,
} from '@/lib/league/real-estate/clients'
import { refreshHousingContextSeries } from '@/lib/league/real-estate/load.server'
import { redactHousingSecrets } from '@/lib/league/real-estate/parse'
import { storedIndexMetric } from '@/lib/league/real-estate/support'
import { writeHousingPrints } from '@/lib/league/real-estate/store.server'
import { supabaseAdmin } from '@/lib/supabase/server'

export function parseHousingBackfillArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes('--apply') && !argv.includes('--dry-run') }
}

export function housingKeyStatus(): Record<string, 'set' | 'missing'> {
  const flag = (name: string) => (process.env[name]?.trim() ? 'set' : 'missing')
  return {
    FRED_API_KEY: flag('FRED_API_KEY'),
    RONE_API_KEY: flag('RONE_API_KEY'),
    ESTAT_APP_ID: flag('ESTAT_APP_ID'),
    ESTAT_HOUSING_STATS_DATA_ID: flag('ESTAT_HOUSING_STATS_DATA_ID'),
  }
}

async function generationInFlight(): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('league_generation_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'running'])
  if (error) throw new Error(error.message)
  return (count ?? 0) > 0
}

export async function runHousingIndexBackfill(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { apply } = parseHousingBackfillArgs(argv)
  const keys = housingKeyStatus()
  console.log(`housing index backfill: ${apply ? 'APPLY' : 'dry-run'}`)
  for (const [name, state] of Object.entries(keys)) console.log(`  ${name}=${state}`)
  const open = PROPERTY_REGIONS.filter((region) => region.country !== 'AU' && region.tier !== 'zillow')
  console.log(`  regions=${open.length} (Australia and Zillow skipped)`)
  if (!apply) {
    console.log('done  dry-run')
    return
  }
  if (await generationInFlight()) {
    throw new Error('a league generation is queued or running; backfill did not fetch')
  }
  const seenAt = new Date().toISOString()
  const cache = {
    uk: null as HousingFetchResult | null,
    krSido: null as HousingFetchResult | null,
    krGu: null as HousingFetchResult | null,
    krWeek: null as HousingFetchResult | null,
    jp: null as HousingFetchResult | null,
  }
  let wrote = 0
  let failed = 0
  for (const region of open) {
    const metric = storedIndexMetric(region.tier, region.metric)
    if (!metric) continue
    try {
      const fetched = await fetchOne(region, cache)
      if (!fetched.ok) {
        failed += 1
        console.log(`${region.country}:${region.code}  ${fetched.error}`)
        continue
      }
      const result = await writeHousingPrints({
        country: region.country,
        regionCode: region.code,
        metric,
        seriesId: fetched.seriesId,
        source: fetched.source,
        sourceUrl: fetched.sourceUrl,
        points: fetched.points,
        seenAt,
      })
      wrote += result.insertedFirst + result.insertedRevision
      console.log(
        `${region.country}:${region.code}  first=${result.insertedFirst} revision=${result.insertedRevision}`,
      )
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : 'error'
      console.log(`${region.country}:${region.code}  ${redactHousingSecrets(message)}`)
    }
  }
  if (keys.FRED_API_KEY === 'set') {
    await refreshHousingContextSeries(seenAt).catch(() => undefined)
  }
  console.log(`done  wrote=${wrote} failed=${failed}`)
  if (failed > 0) process.exitCode = 1
}

type HousingCache = {
  uk: HousingFetchResult | null
  krSido: HousingFetchResult | null
  krGu: HousingFetchResult | null
  krWeek: HousingFetchResult | null
  jp: HousingFetchResult | null
}

async function fetchOne(region: (typeof PROPERTY_REGIONS)[number], cache: HousingCache) {
  if (region.country === 'US') {
    const seriesId = fredSeriesForRegion(region)
    if (!seriesId) return { ok: false as const, error: 'no FRED series' }
    return fetchFredSeries(seriesId, process.env.FRED_API_KEY)
  }
  if (region.country === 'UK') {
    cache.uk ??= await fetchUkHpi(new Date())
    if (!cache.uk.ok) return cache.uk
    const points = pointsForArea(cache.uk.points, region.code)
    return points.length ? { ...cache.uk, points } : { ok: false as const, error: 'area missing in UK HPI' }
  }
  if (region.country === 'KR') return fetchKorea(region.code, cache)
  if (process.env.ESTAT_HOUSING_STATS_DATA_ID?.trim()) {
    return fetchEstatHousing(region.code, process.env.ESTAT_APP_ID, process.env.ESTAT_HOUSING_STATS_DATA_ID)
  }
  cache.jp ??= await fetchMlitHousing()
  if (!cache.jp.ok) return cache.jp
  const points = pointsForArea(cache.jp.points, region.code)
  return points.length ? { ...cache.jp, points } : { ok: false as const, error: `MLIT workbook has no NSA row for ${region.code}` }
}

async function fetchKorea(regionCode: string, cache: HousingCache) {
  const spec = roneTableForRegion(regionCode)
  const now = new Date()
  if (spec.statblId === RONE_MONTHLY_STATBL) {
    cache.krSido ??= await fetchRoneTable(
      process.env.RONE_API_KEY,
      fetch,
      now,
      process.env.RONE_APT_SALE_STATBL_ID?.trim() || RONE_MONTHLY_STATBL,
      'MM',
    )
    if (!cache.krSido.ok) return cache.krSido
    const points = pointsForArea(cache.krSido.points, regionCode)
    return points.length ? { ...cache.krSido, points } : { ok: false as const, error: `R-ONE has no row for ${regionCode}` }
  }
  cache.krGu ??= await fetchRoneTable(
    process.env.RONE_API_KEY,
    fetch,
    now,
    process.env.RONE_SIGUNGU_STATBL_ID?.trim() || RONE_SIGUNGU_STATBL,
    'MM',
  )
  if (cache.krGu.ok) {
    const points = pointsForArea(cache.krGu.points, regionCode)
    if (points.length) return { ...cache.krGu, points }
  }
  cache.krWeek ??= await fetchRoneTable(process.env.RONE_API_KEY, fetch, now, RONE_WEEKLY_STATBL, 'WK')
  if (!cache.krWeek.ok) return { ok: false as const, error: `R-ONE has no monthly apartment sale index row for ${regionCode}` }
  const points = pointsForArea(cache.krWeek.points, regionCode)
  return points.length
    ? { ...cache.krWeek, points }
    : { ok: false as const, error: `R-ONE has no monthly apartment sale index row for ${regionCode}` }
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/housing-index-backfill.ts')
if (isMain) {
  runHousingIndexBackfill().catch((err) => {
    const message = err instanceof Error ? err.message : 'housing backfill failed'
    console.error(redactHousingSecrets(message))
    process.exit(1)
  })
}
