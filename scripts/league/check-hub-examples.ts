/**
 * Live dry check: every published hub example through the real gateway resolvers.
 * No generation. No charge. Aborts if a league generation job is in flight.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/check-hub-examples.ts
 */
import { adapterForCategoryId } from '../../lib/league/gateway/adapters/registry.server'
import { listHubExamples } from '../../lib/league/gateway/hub-examples'
import type { GatewayViewer } from '../../lib/league/gateway/types'
import { supabaseAdmin } from '../../lib/supabase/server'

const US: GatewayViewer = {
  userId: 'hub-example-check',
  isAdmin: false,
  jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
}

async function assertIdle(): Promise<void> {
  const { count, error } = await supabaseAdmin
    .from('league_generation_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'running'])
  if (error) throw new Error(`in-flight check failed: ${error.message}`)
  if ((count ?? 0) > 0) {
    console.log(JSON.stringify({ abort: 'generation in flight', inFlight: count }))
    process.exit(2)
  }
}

async function main() {
  await assertIdle()
  const rows = listHubExamples()
  const fails: Array<{ locale: string; hub: string; text: string; code: string }> = []
  const ok: Array<{ locale: string; hub: string; text: string; kind: 'ready' | 'clarify' }> = []

  for (const row of rows) {
    const adapter = adapterForCategoryId(row.category)
    if (!adapter) {
      fails.push({ locale: row.locale, hub: row.hub, text: row.text, code: 'no_adapter' })
      continue
    }
    const hit = await adapter.resolveEntity(row.text, row.locale, US)
    if (hit.ok) {
      ok.push({ locale: row.locale, hub: row.hub, text: row.text, kind: 'ready' })
      continue
    }
    if ('need' in hit) {
      ok.push({ locale: row.locale, hub: row.hub, text: row.text, kind: 'clarify' })
      continue
    }
    fails.push({ locale: row.locale, hub: row.hub, text: row.text, code: hit.refuse.code })
  }

  console.log(
    JSON.stringify(
      {
        checked: rows.length,
        ok: ok.length,
        refused: fails.length,
        fails,
      },
      null,
      2,
    ),
  )
  if (fails.length) process.exit(1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
