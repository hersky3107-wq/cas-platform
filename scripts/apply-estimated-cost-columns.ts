/**
 * Apply the league ledger columns if they are missing.
 * Uses the Supabase Management API (SUPABASE_ACCESS_TOKEN + project ref).
 *
 *   npx tsx --env-file=.env.local scripts/apply-estimated-cost-columns.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!url || !token) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN')
  const ref = new URL(url).hostname.split('.')[0]
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260829000001_model_predictions_estimated_cost.sql'),
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
  console.log('applied estimated_cost_usd + server_side_tools_used')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
