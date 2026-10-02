import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { orderVisibleUniverseRows, type UniverseMarket } from './korea-equity-catalog'
import { mapUniverseDbRow, type LeagueKrUniverseDbRow, type UniverseRecord } from './korea-universe-apply'

const TABLE = 'league_kr_universe'

export type { UniverseRecord }

export async function listVisibleUniverse(market: UniverseMarket): Promise<UniverseRecord[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .eq('market', market)
    .eq('visible', true)

  if (error) throw new Error(`league_kr_universe listVisibleUniverse: ${error.message}`)

  const rows = ((data ?? []) as LeagueKrUniverseDbRow[])
    .map(mapUniverseDbRow)
    .filter((row): row is UniverseRecord => row !== null)
  return orderVisibleUniverseRows(rows, market)
}

export async function isUniverseCodeVisible(market: UniverseMarket, code: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('visible')
    .eq('market', market)
    .eq('code', code)
    .maybeSingle()

  if (error) throw new Error(`league_kr_universe isUniverseCodeVisible: ${error.message}`)
  return data?.visible === true
}
