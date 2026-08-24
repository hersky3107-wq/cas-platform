/**
 * Verify the durable research-packet cache (league_research_packets).
 *
 * Run TWICE in SEPARATE processes with the same args. The in-process memory
 * cache dies with the process, so a `cached: true` on the second run can only
 * come from the durable table. `costUsd === 0` on a cache hit proves zero
 * director/Perplexity calls (getResearchPacket only spends after both cache
 * reads miss).
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-research-durable-cache.ts
 */
import { getResearchPacket, researchCacheKey } from '../lib/league/research'
import { supabaseAdmin } from '../lib/supabase/server'

const round = {
  instrument: 'AAPL',
  category: 'stock',
  proposition_text: 'Will AAPL close higher than the prior regular-session close?',
  horizon: '24h',
  resolution_rule: 'AAPL regular-session close vs prior close',
  resolves_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
}

async function main() {
  const key = researchCacheKey(round.instrument, round.horizon)
  console.log('cacheKey:', key)

  const t0 = Date.now()
  const packet = await getResearchPacket({ round, budgetRemainingUsd: 2 })
  const ms = Date.now() - t0

  console.log('result:', {
    available: packet.available,
    cached: packet.cached,
    costUsd: Number(packet.costUsd.toFixed(4)),
    queries: packet.queries.length,
    findings: packet.findings.length,
    error: packet.error ?? null,
    elapsedMs: ms,
  })

  const { count, error } = await supabaseAdmin
    .from('league_research_packets')
    .select('cache_key', { count: 'exact', head: true })
  console.log('league_research_packets row count:', count ?? 0, error ? `(count error: ${error.message})` : '')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
