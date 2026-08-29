/**
 * Apply the contract-neutral side-token ledger migration.
 * Uses the Supabase Management API (SUPABASE_ACCESS_TOKEN + project ref) —
 * same pattern as apply-estimated-cost-columns.ts.
 *
 *   npx tsx --env-file=.env.local scripts/apply-side-token-ledger.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!url || !token) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN')
  const ref = new URL(url).hostname.split('.')[0]
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260829000002_side_token_ledger.sql'),
    'utf8',
  )
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.text()
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${body.slice(0, 400)}`)
  }
  console.log('applied 20260829000002_side_token_ledger.sql')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
