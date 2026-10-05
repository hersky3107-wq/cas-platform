import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { planVintageWrites, type IncomingPrint, type VintageWrite } from './vintage'

export type StoredHousingPrint = {
  country: string
  regionCode: string
  metric: string
  seriesId: string
  refPeriod: string
  value: number
  firstPublishedAt: string
  source: string
  sourceUrl: string | null
}

export async function readFirstPrints(
  country: string,
  regionCode: string,
  metric: string,
): Promise<StoredHousingPrint[]> {
  const { data, error } = await supabaseAdmin
    .from('league_housing_index_prints')
    .select('country, region_code, metric, series_id, ref_period, value, first_published_at, source, source_url')
    .eq('country', country)
    .eq('region_code', regionCode)
    .eq('metric', metric)
    .eq('vintage', 'first')
    .order('ref_period', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToPrint)
}

export async function writeHousingPrints(args: {
  country: string
  regionCode: string
  metric: string
  seriesId: string
  source: string
  sourceUrl: string
  points: readonly IncomingPrint[]
  seenAt: string
}): Promise<{ insertedFirst: number; insertedRevision: number }> {
  const existing = await readFirstPrints(args.country, args.regionCode, args.metric)
  const firstValues = new Map(existing.map((row) => [row.refPeriod, row.value]))
  const planned = planVintageWrites(firstValues, args.points, args.seenAt)
  const writes = await dropStoredRevisions(args, planned)
  const rows = writes.map((write) => ({
    country: args.country,
    region_code: args.regionCode,
    metric: args.metric,
    series_id: args.seriesId,
    ref_period: write.refPeriod,
    value: write.value,
    vintage: write.kind,
    first_published_at: write.seenAt,
    fetched_at: write.seenAt,
    source: args.source,
    source_url: args.sourceUrl,
  }))
  if (rows.length === 0) return { insertedFirst: 0, insertedRevision: 0 }
  const { error } = await supabaseAdmin.from('league_housing_index_prints').insert(rows)
  if (error) throw new Error(error.message)
  return {
    insertedFirst: writes.filter((row) => row.kind === 'first').length,
    insertedRevision: writes.filter((row) => row.kind === 'revision').length,
  }
}

async function dropStoredRevisions(
  args: { country: string; regionCode: string; metric: string },
  writes: VintageWrite[],
): Promise<VintageWrite[]> {
  const periods = writes.filter((row) => row.kind === 'revision').map((row) => row.refPeriod)
  if (periods.length === 0) return writes
  const { data, error } = await supabaseAdmin
    .from('league_housing_index_prints')
    .select('ref_period, value')
    .eq('country', args.country)
    .eq('region_code', args.regionCode)
    .eq('metric', args.metric)
    .eq('vintage', 'revision')
    .in('ref_period', periods)
  if (error) throw new Error(error.message)
  const stored = new Set((data ?? []).map((row) => `${row.ref_period}|${Number(row.value)}`))
  return writes.filter((row) => row.kind === 'first' || !stored.has(`${row.refPeriod}|${row.value}`))
}

function rowToPrint(row: {
  country: string
  region_code: string
  metric: string
  series_id: string
  ref_period: string
  value: number | string
  first_published_at: string
  source: string
  source_url: string | null
}): StoredHousingPrint {
  return {
    country: row.country,
    regionCode: row.region_code,
    metric: row.metric,
    seriesId: row.series_id,
    refPeriod: row.ref_period,
    value: Number(row.value),
    firstPublishedAt: row.first_published_at,
    source: row.source,
    sourceUrl: row.source_url,
  }
}
