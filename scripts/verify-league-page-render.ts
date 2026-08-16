/**
 * Renders `/league` as a REAL logged-in non-admin user and reports what came
 * back, so the public hub is verified end to end (middleware -> page -> client
 * components) rather than only at the type/lint level.
 *
 * Builds the same `sb-<ref>-auth-token` cookie shape `@supabase/ssr` writes
 * (base64-prefixed session JSON, chunked at 3180 chars) from a throwaway user,
 * then deletes that user.
 *
 * Run (dev server must be up):
 *   npx tsx --env-file=.env.local scripts/verify-league-page-render.ts
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../lib/supabase/server'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const CHUNK_SIZE = 3180

let failures = 0

function report(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`)
}

function projectRef(): string {
  return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]!
}

function sessionCookies(session: unknown): string {
  const name = `sb-${projectRef()}-auth-token`
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  if (value.length <= CHUNK_SIZE) return `${name}=${value}`
  const parts: string[] = []
  for (let i = 0; i * CHUNK_SIZE < value.length; i += 1) {
    parts.push(`${name}.${i}=${value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)}`)
  }
  return parts.join('; ')
}

async function main() {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const email = `league-render-${Date.now()}@example.com`
  const password = `Rn-${Math.random().toString(36).slice(2)}-${Date.now()}`

  const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`)
  const userId = created.data.user.id

  try {
    await supabaseAdmin.from('users').upsert({ id: userId, credits: 25, declared_country: 'KR' }, { onConflict: 'id' })
    const signIn = await anon.auth.signInWithPassword({ email, password })
    if (signIn.error || !signIn.data.session) throw new Error(`signIn: ${signIn.error?.message}`)

    const cookie = sessionCookies(signIn.data.session)

    for (const path of ['/league', '/league/leaderboard', '/league/record-room']) {
      const anonRes = await fetch(`${BASE}${path}`, { redirect: 'manual' })
      const target = anonRes.headers.get('location') ?? ''
      report(
        `GET ${path} (no session) -> /auth`,
        (anonRes.status === 307 || anonRes.status === 302) && target.includes('/auth'),
        `${anonRes.status} ${target}`
      )

      const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' })
      const html = res.status === 200 ? await res.text() : ''
      report(
        `GET ${path} (session) -> 200 + hub chrome + price note`,
        res.status === 200 && html.includes('AI Prediction League') && html.includes('Only a live run spends credits'),
        `${res.status}, ${html.length} bytes, title=${html.includes('AI Prediction League')}, priceNote=${html.includes(
          'Only a live run spends credits'
        )}`
      )
    }
  } finally {
    await supabaseAdmin.from('users').delete().eq('id', userId)
    await supabaseAdmin.auth.admin.deleteUser(userId)
    console.log(`cleanup: removed ${userId}`)
  }

  if (failures > 0) {
    console.error(`\n${failures} render check(s) failed`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('render check crashed:', e)
  process.exit(1)
})
