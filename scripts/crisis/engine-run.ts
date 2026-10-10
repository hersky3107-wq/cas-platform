/**
 * One region, or the N highest-stage regions, through the crisis engine.
 *
 * Dry-run prints prompts and token estimates. It does not call a model or a search API.
 *
 *   npx tsx --require ./scripts/crisis/register-server-only.cjs --env-file=.env.local scripts/crisis/engine-run.ts --region=Badulla --horizon=30d --dry-run
 *   npx tsx --require ./scripts/crisis/register-server-only.cjs --env-file=.env.local scripts/crisis/engine-run.ts --region=Badulla --horizon=30d --live --force
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_COST_CAP_USD } from '../../lib/crisis/engine/prices'
import { estimateRegionRunUsd } from '../../lib/crisis/engine/roster'
import { runEngine, type EngineCache, type EngineRunRecord } from '../../lib/crisis/engine/run'
import { HORIZONS, type EngineCard, type Horizon, type Hypothesis } from '../../lib/crisis/engine/schema'
import type { RegionScore } from '../../lib/crisis/score/types'

function arg(name: string): string | undefined {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

function wants(flag: string): boolean {
  return process.argv.includes(flag)
}

function cardFromScore(row: RegionScore, horizon: Horizon): EngineCard {
  if (row.lat == null || row.lon == null) throw new Error(`region ${row.region_id} has no centroid`)
  return {
    region_id: row.region_id,
    name: row.name,
    country: row.country,
    iso3: row.iso3,
    lat: row.lat,
    lon: row.lon,
    level: row.level ?? 1,
    horizon,
    components: row.components.map((row) => ({ key: row.key, value: row.value, raw: row.raw })),
    fragility: row.fragility_items.map((item) => ({ kind: item.kind, name: item.name })),
    cascades: row.cascades.map((item) => ({ id: item.id, trigger: item.trigger_type, effect: item.effect_type })),
    context: row.context,
    urban: row.urban_centres.map((item) => ({ name: item.name, pop: item.pop })),
  }
}

function pickRegions(rows: RegionScore[], region: string | undefined, top: number | undefined): RegionScore[] {
  if (region && top) throw new Error('Pass --region or --top, not both')
  if (top) {
    return [...rows].sort((a, b) => b.stage - a.stage || b.score - a.score).slice(0, top)
  }
  if (!region) throw new Error('Pass --region=<id|name> or --top=N, and --dry-run or --live')
  const asId = /^\d+$/.test(region) ? Number(region) : null
  if (asId != null) {
    const hit = rows.find((row) => row.region_id === asId)
    if (!hit) throw new Error(`no scored region ${asId}`)
    return [hit]
  }
  const needle = region.toLowerCase()
  const exact = rows.filter((row) => row.name.toLowerCase() === needle)
  const hits = exact.length > 0 ? exact : rows.filter((row) => row.name.toLowerCase().includes(needle))
  if (hits.length === 0) throw new Error(`no scored region named ${region}`)
  if (hits.length > 1) {
    const names = hits.slice(0, 8).map((row) => `${row.region_id}:${row.name}`).join(', ')
    throw new Error(`region name ${region} matched ${hits.length} rows (${names}). Pass --region=<id>.`)
  }
  return hits
}

function printRecord(record: EngineRunRecord, dryRun: boolean): void {
  console.log(`region=${record.regionId} cache_key=${record.cacheKey} cache_hit=${record.cacheHit} status=${record.status} partial=${record.result?.partial ?? false}`)
  console.log(`queries=${JSON.stringify(record.queries)}`)
  for (const step of record.steps) {
    console.log(
      `step role=${step.role} slot=${step.slot} model=${step.model} in=${step.inputTokens} out=${step.outputTokens} usd=${step.costUsd.toFixed(6)} skipped=${step.skipped} error=${step.error ?? ''}`,
    )
    if (step.role === 'search' && step.output && typeof step.output === 'object') {
      const output = step.output as { items?: unknown[]; origin?: unknown }
      console.log(`  search_items=${Array.isArray(output.items) ? output.items.length : 0} origin=${JSON.stringify(output.origin ?? null)}`)
    }
    if (dryRun) {
      console.log(`--- system ${step.slot}`)
      console.log(step.system)
      console.log(`--- user ${step.slot}`)
      console.log(step.user)
    }
  }
  console.log(`total_usd=${record.costUsd.toFixed(6)} tokens_in=${record.tokensIn} tokens_out=${record.tokensOut}`)
  const result = record.result
  if (!result) return
  const counts = result.coverage ?? {}
  console.log(`coverage reliefweb=${counts.reliefweb ?? 0} gdacs=${counts.gdacs ?? 0} metaculus=${counts.metaculus ?? 0} mainstream=${counts.mainstream ?? 0} (last 30 days, this country)`)
  console.log(`novelty only_us=${result.novelty_counts?.only_us ?? 0} also_seen_elsewhere=${result.novelty_counts?.also_seen_elsewhere ?? 0} (every group, before ranking)`)
  console.log(`background_coverage=${result.background_coverage?.length ?? 0}`)
  if (result.headline_fallback) console.log('headline_fallback=true')
  console.log(`obvious_list=${JSON.stringify(result.obvious ?? [])}`)
  for (const row of result.rejected ?? []) console.log(`rejected model=${row.model} title=${row.title} reasons=${row.reasons.join('; ')}`)
  console.log(`headline_ko=${result.headline_ko}`)
  console.log(`headline_en=${result.headline_en}`)
  console.log(`summary_ko=${result.summary_ko}`)
  console.log(`summary_en=${result.summary_en}`)
  const print = (label: string, row: Hypothesis) => {
    console.log(`${label} title=${row.title}`)
    console.log(`  proposed_by=${row.proposed_by.length} [${row.proposed_by.join(', ')}] stage=${row.stage} possibility=${row.possibility} non_obviousness=${row.non_obviousness ?? ''}`)
    console.log(`  novelty=${row.novelty}${row.novelty_match ? ` match=${row.novelty_match.source}/${row.novelty_match.scope}/${row.novelty_match.hazard} ${row.novelty_match.url}` : ''}`)
    console.log(`  departments=${(row.departments ?? []).join(',')} entities=${JSON.stringify(row.entities ?? [])} lead_time_days=${row.lead_time_days ? `${row.lead_time_days.min}-${row.lead_time_days.max}` : ''}`)
    if (row.twist) console.log(`  twist=${row.twist}`)
    console.log(`  mechanism=${row.mechanism ?? ''}`)
    console.log(`  early_indicators=${JSON.stringify(row.early_indicators ?? [])}`)
    console.log(`  falsifier=${row.falsifier ?? ''}`)
    console.log(`  why_humans_miss=${row.why_humans_miss}`)
    console.log(`  what_to_do=${JSON.stringify(row.what_to_do)}`)
  }
  console.log('--- tier headlines ---')
  result.headlines.forEach((row, index) => print(`headline[${index}]`, row))
  console.log('--- tier missed_by_others ---')
  result.missed_by_others.forEach((row, index) => print(`missed[${index}]`, row))
  console.log('--- tier baseline_risks ---')
  console.log(`baseline_risks=${result.baseline_risks.length}`)
  for (const row of result.baseline_risks) {
    console.log(`baseline title=${row.title} stage=${row.stage} possibility=${row.possibility} reason=${row.reason ?? ''}`)
    console.log(`  what_to_do=${JSON.stringify(row.what_to_do)}`)
  }
  for (const row of result.background_coverage ?? []) {
    console.log(`background ${row.source}/${row.hazard} span=${JSON.stringify(row.matched_span)} ${row.url}`)
  }
}

async function main(): Promise<void> {
  const dryRun = wants('--dry-run')
  const live = wants('--live')
  if (dryRun === live) throw new Error('Pass exactly one of --dry-run or --live')
  const horizonArg = arg('horizon') ?? '30d'
  if (!HORIZONS.includes(horizonArg as Horizon)) throw new Error('--horizon must be 7d, 30d, or 180d')
  const horizon = horizonArg as Horizon
  const region = arg('region')
  const topArg = arg('top')
  const top = topArg == null ? undefined : Number(topArg)
  if (topArg != null && (!Number.isInteger(top) || top < 1)) throw new Error('--top must be a positive integer')

  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const { runLayer1Score } = await import('../../lib/crisis/score/job')
  const capArg = arg('cap-usd')
  const costCapUsd = capArg != null ? Number(capArg) : DEFAULT_COST_CAP_USD
  if (!Number.isFinite(costCapUsd) || costCapUsd <= 0) throw new Error('--cap-usd must be a positive number')
  console.log(`typical_list_price_usd=${estimateRegionRunUsd().toFixed(4)} cap_usd=${costCapUsd.toFixed(2)} (list-price estimate, not a live quote)`)
  const scored = await runLayer1Score(supabaseAdmin, { dryRun: true, write: false, log: () => {} })
  const picked = pickRegions(scored.rows, region, top)
  console.log(`mode=${top ? 'top' : 'region'} count=${picked.length} horizon=${horizon}`)

  const cache: EngineCache | undefined = live
    ? {
        async get(key) {
          const { loadCachedRun } = await import('../../lib/crisis/engine/store')
          return loadCachedRun(supabaseAdmin, key)
        },
        async put(record) {
          const { persistRun } = await import('../../lib/crisis/engine/store')
          record.id = await persistRun(supabaseAdmin, record, 'admin')
        },
      }
    : undefined

  const caller = live
    ? (await import('../../lib/crisis/engine/live-caller')).liveCaller()
    : {
        async complete() {
          throw new Error('dry-run tried to call a model')
        },
      }

  const { loadCoverage } = await import('../../lib/crisis/engine/coverage-load')
  const { coverageCounts } = await import('../../lib/crisis/engine/coverage')
  for (const row of picked) {
    const card = cardFromScore(row, horizon)
    const coverage = await loadCoverage(supabaseAdmin, card, new Date())
    const counts = coverageCounts(coverage)
    console.log(`coverage_db region=${card.name} iso3=${card.iso3} reliefweb=${counts.reliefweb} gdacs=${counts.gdacs} metaculus=${counts.metaculus} region_match=${coverage.filter((item) => item.region_match).length}`)
    const record = await runEngine({
      card,
      caller,
      dryRun,
      mode: top ? 'top' : 'region',
      cache,
      force: wants('--force'),
      coverage,
      costCapUsd,
    })
    printRecord(record, dryRun)
    if (record.id) console.log(`run_id=${record.id}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
