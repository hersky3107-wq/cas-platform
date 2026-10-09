/**
 * Rebuild admin1 neighbour pairs. The migration must be pasted first.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/build-neighbors.ts
 *   npx tsx --env-file=.env.local scripts/crisis/build-neighbors.ts --apply
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

function wants(flag: string): boolean {
  return process.argv.includes(flag)
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const started = Date.now()
  if (!wants('--apply')) {
    const { count, error } = await supabaseAdmin
      .from('crisis_region_neighbors')
      .select('region_id', { count: 'exact', head: true })
    if (error) {
      console.log(`migration unapplied or unreadable: ${error.message}`)
      console.log('Paste docs/crisis/APPLY_PREEVENT.md, then re-run with --apply.')
      return
    }
    console.log(`directed_pairs=${count ?? 0} undirected_pairs=${Math.round((count ?? 0) / 2)} read_ms=${Date.now() - started}`)
    return
  }
  const { data, error } = await supabaseAdmin.rpc('crisis_refresh_region_neighbors')
  if (error) throw new Error(error.message)
  const directed = Number(data ?? 0)
  console.log(`directed_pairs=${directed} undirected_pairs=${Math.round(directed / 2)} runtime_ms=${Date.now() - started}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
