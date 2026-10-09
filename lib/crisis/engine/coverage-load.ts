import type { SupabaseClient } from '@supabase/supabase-js'
import { COVERAGE_DAYS, coverageFromSignals, type CoverageItem, type CoverageSignalRow } from './coverage'
import type { EngineCard } from './schema'

const COLUMNS = 'source, signal_type, title, url, country_iso3, region_id, event_time, value_raw'

/** ReliefWeb, GDACS, and Metaculus coverage for one card. Reads crisis_raw_signals only. */
export async function loadCoverage(client: SupabaseClient, card: EngineCard, now: Date): Promise<CoverageItem[]> {
  if (!card.iso3) return []
  const since = new Date(now.getTime() - COVERAGE_DAYS * 86_400_000).toISOString()
  const rows: CoverageSignalRow[] = []
  const reliefweb = await client
    .from('crisis_raw_signals')
    .select(COLUMNS)
    .eq('source', 'reliefweb')
    .eq('country_iso3', card.iso3)
    .order('event_time', { ascending: false })
    .limit(400)
  if (reliefweb.error) throw new Error(`coverage reliefweb: ${reliefweb.error.message}`)
  rows.push(...((reliefweb.data ?? []) as CoverageSignalRow[]))

  const gdacs = await client
    .from('crisis_raw_signals')
    .select(COLUMNS)
    .eq('source', 'gdacs')
    .or(`country_iso3.eq.${card.iso3},region_id.eq.${card.region_id}`)
    .gte('event_time', since)
    .order('event_time', { ascending: false })
    .limit(200)
  if (gdacs.error) throw new Error(`coverage gdacs: ${gdacs.error.message}`)
  rows.push(...((gdacs.data ?? []) as CoverageSignalRow[]))

  const metaculus = await client
    .from('crisis_raw_signals')
    .select(COLUMNS)
    .eq('source', 'metaculus')
    .contains('value_raw', { countries: [card.iso3] })
    .limit(200)
  if (metaculus.error) throw new Error(`coverage metaculus: ${metaculus.error.message}`)
  rows.push(...((metaculus.data ?? []) as CoverageSignalRow[]))

  return coverageFromSignals(rows, card, now)
}
