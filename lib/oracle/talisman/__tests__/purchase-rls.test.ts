import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260926000001_talisman_purchases.sql',
)

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

function policyBodies(sql: string): string[] {
  return [...stripSqlComments(sql).matchAll(/create policy[\s\S]*?;/gi)].map((m) => m[0])
}

describe('talisman_purchases RLS', () => {
  const sql = readFileSync(MIGRATION, 'utf8')
  const policies = policyBodies(sql)

  it('lets authenticated users SELECT their own rows only', () => {
    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatch(/for\s+select/i)
    expect(policies[0]).toMatch(/to\s+authenticated/i)
    expect(policies[0]).toMatch(/using\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)/i)
    expect(policies[0]).not.toMatch(/with\s+check/i)
  })

  it('has no INSERT / UPDATE / DELETE / ALL policy for authenticated or anon', () => {
    for (const policy of policies) {
      expect(policy).not.toMatch(/for\s+insert/i)
      expect(policy).not.toMatch(/for\s+update/i)
      expect(policy).not.toMatch(/for\s+delete/i)
      expect(policy).not.toMatch(/for\s+all/i)
      expect(policy).not.toMatch(/\bto\s+anon\b/i)
    }
    expect(sql).toMatch(/cannot INSERT/i)
  })
})
