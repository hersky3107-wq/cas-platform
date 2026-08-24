/**
 * End-to-end credit safety net tests for league_deep_runs, covering the
 * claim → charge → build-context reorder.
 *
 * Scenario A — single charge on a double-click:
 *   Creates a throwaway auth user with 100 synthetic credits, fires TWO
 *   CONCURRENT deep-open requests (same round, same user — the double-click
 *   case), then asserts:
 *     - exactly ONE league_deep_runs row for (round, 'open', user)
 *     - exactly ONE 50-credit deduction (credits 100 -> 50)
 *     - exactly ONE credit_logs entry for the deep-open module
 *
 * Scenario B — forced context-build failure after charge:
 *   Creates a second throwaway user, forces `buildLeagueDeepContext` to
 *   throw for this round via the `LEAGUE_DEEP_FORCE_CONTEXT_FAIL_ROUND_ID`
 *   test hook (see lib/league/deep-context.ts), then asserts:
 *     - 1st failed seed: charged once (100 -> 50), row stays `running` with
 *       an unseeded state and seedAttempts=1 — NOT refunded, NOT lost,
 *       resumable by the next click. No pipeline work ever ran.
 *     - 2nd failed seed (same sessionId): seedAttempts=2, still no second
 *       charge, still resumable.
 *     - 3rd failed seed hits MAX_SEED_ATTEMPTS: status flips to 'error' and
 *       the run is refunded through the exact same `finishRefund` path a
 *       failed pipeline uses (lib/league/deep-http.ts) — credits back to
 *       100. Net: 0 lost credits, and the row is now restartable.
 *
 * Cleanup: deletes each auth user (league_deep_runs cascades via FK).
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-deep-run-single-charge.ts
 */
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '../lib/supabase/server'
import { handleDeepAnalysis } from '../lib/league/deep-http'
import type { LeagueViewer } from '../lib/league/public-access'

const ROUND_ID = 'fffc1716-cd3d-45f2-883f-1242a373febc'

type TestUser = { userId: string; email: string; viewer: LeagueViewer }

async function makeTestUser(tag: string): Promise<TestUser> {
  const email = `deep-run-test-${tag}-${randomUUID().slice(0, 8)}@example.invalid`
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomUUID(),
  })
  if (created.error || !created.data.user) {
    throw new Error(`createUser failed: ${created.error?.message}`)
  }
  const userId = created.data.user.id

  // A signup trigger auto-creates the public.users row; set the balance.
  const upd = await supabaseAdmin.from('users').update({ credits: 100 }).eq('id', userId)
  if (upd.error) throw new Error(`users credits update failed: ${upd.error.message}`)
  const check = await supabaseAdmin.from('users').select('credits').eq('id', userId).maybeSingle()
  if (check.data?.credits !== 100) throw new Error(`credits not set: ${JSON.stringify(check)}`)

  const viewer: LeagueViewer = {
    userId,
    email,
    isAdmin: false,
    jurisdiction: { ipCountry: 'KR' },
    visibleCategories: ['stock'],
  }
  return { userId, email, viewer }
}

async function cleanupUser(userId: string): Promise<void> {
  await supabaseAdmin.from('credit_logs').delete().eq('user_id', userId)
  await supabaseAdmin.from('users').delete().eq('id', userId)
  const del = await supabaseAdmin.auth.admin.deleteUser(userId)
  console.log('  cleanup: auth user deleted:', !del.error, del.error?.message ?? '')
  const left = await supabaseAdmin
    .from('league_deep_runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  console.log('  run rows remaining for test user (expect 0):', left.count ?? 0)
}

async function creditsFor(userId: string): Promise<number | undefined> {
  const bal = await supabaseAdmin.from('users').select('credits').eq('id', userId).maybeSingle()
  return bal.data?.credits
}

async function scenarioA(): Promise<boolean> {
  console.log('\n=== Scenario A: two concurrent clicks charge exactly once ===')
  const { userId, email, viewer } = await makeTestUser('a')
  console.log('test user:', userId, email)

  try {
    const t0 = Date.now()
    const [resA, resB] = await Promise.all([
      handleDeepAnalysis({ product: 'open', viewer, roundId: ROUND_ID, locale: null, sessionId: null }),
      handleDeepAnalysis({ product: 'open', viewer, roundId: ROUND_ID, locale: null, sessionId: null }),
    ])
    const bodyA = (await resA.json()) as Record<string, unknown>
    const bodyB = (await resB.json()) as Record<string, unknown>
    console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    console.log('response A:', resA.status, {
      ok: bodyA.ok, done: bodyA.done, stage: bodyA.stage, sessionId: bodyA.sessionId, error: bodyA.error,
    })
    console.log('response B:', resB.status, {
      ok: bodyB.ok, done: bodyB.done, stage: bodyB.stage, sessionId: bodyB.sessionId, error: bodyB.error,
    })

    const runs = await supabaseAdmin
      .from('league_deep_runs')
      .select('id, status, stage, charged, charged_cost, deduct_skipped, refunded, billed_usd, provider_calls, state')
      .eq('round_id', ROUND_ID)
      .eq('product', 'open')
      .eq('user_id', userId)
    console.log('run rows:', runs.data?.length ?? 0, runs.data)

    const bal = await creditsFor(userId)
    console.log('credits after (expect 50):', bal)

    const logs = await supabaseAdmin.from('credit_logs').select('module, amount').eq('user_id', userId)
    console.log('credit_logs rows:', logs.data?.length ?? 0, logs.data)

    const oneRow = (runs.data?.length ?? 0) === 1
    const oneCharge = bal === 50
    const oneLog = (logs.data ?? []).filter((l) => String(l.module).includes('deep')).length === 1
    const pass = oneRow && oneCharge && oneLog
    console.log(pass ? 'PASS A: one row, one charge, one log' : 'FAIL A: see above')
    return pass
  } finally {
    await cleanupUser(userId)
  }
}

async function scenarioB(): Promise<boolean> {
  console.log('\n=== Scenario B: forced context-build failure after charge ===')
  const { userId, email, viewer } = await makeTestUser('b')
  console.log('test user:', userId, email)

  const envKey = 'LEAGUE_DEEP_FORCE_CONTEXT_FAIL_ROUND_ID'
  process.env[envKey] = ROUND_ID

  try {
    // --- 1st failed seed ---
    const res1 = await handleDeepAnalysis({ product: 'open', viewer, roundId: ROUND_ID, locale: null, sessionId: null })
    const body1 = (await res1.json()) as Record<string, unknown>
    console.log('click 1 (charge + forced seed fail):', res1.status, { ok: body1.ok, done: body1.done, stage: body1.stage })

    const row1 = await supabaseAdmin
      .from('league_deep_runs')
      .select('id, status, stage, charged, charged_cost, refunded, state')
      .eq('round_id', ROUND_ID)
      .eq('product', 'open')
      .eq('user_id', userId)
      .maybeSingle()
    console.log('row after click 1:', row1.data)
    const bal1 = await creditsFor(userId)
    console.log('credits after click 1 (expect 50 — charged, held, NOT lost):', bal1)

    const sessionId = body1.sessionId as string | undefined
    const state1 = (row1.data?.state ?? {}) as { __unseeded?: boolean; seedAttempts?: number }
    const check1 =
      res1.status === 200 &&
      body1.ok === true &&
      body1.done === false &&
      row1.data?.status === 'running' &&
      row1.data?.charged === true &&
      row1.data?.refunded === false &&
      state1.__unseeded === true &&
      state1.seedAttempts === 1 &&
      bal1 === 50
    console.log(check1 ? 'PASS B1: resumable row, charged once, 0 credits lost' : 'FAIL B1: see above')

    // --- 2nd failed seed (same session) — must NOT charge again ---
    const res2 = await handleDeepAnalysis({ product: 'open', viewer, roundId: ROUND_ID, locale: null, sessionId: sessionId ?? null })
    const body2 = (await res2.json()) as Record<string, unknown>
    const row2 = await supabaseAdmin
      .from('league_deep_runs')
      .select('status, refunded, state')
      .eq('round_id', ROUND_ID)
      .eq('product', 'open')
      .eq('user_id', userId)
      .maybeSingle()
    const bal2 = await creditsFor(userId)
    const state2 = (row2.data?.state ?? {}) as { seedAttempts?: number }
    console.log('click 2:', res2.status, { ok: body2.ok, done: body2.done }, 'seedAttempts:', state2.seedAttempts, 'credits:', bal2)
    const check2 = row2.data?.status === 'running' && state2.seedAttempts === 2 && bal2 === 50
    console.log(check2 ? 'PASS B2: no double charge on repeated seed failure' : 'FAIL B2: see above')

    // --- 3rd failed seed — hits MAX_SEED_ATTEMPTS, must refund via finishRefund ---
    const res3 = await handleDeepAnalysis({ product: 'open', viewer, roundId: ROUND_ID, locale: null, sessionId: sessionId ?? null })
    const body3 = (await res3.json()) as Record<string, unknown>
    const row3 = await supabaseAdmin
      .from('league_deep_runs')
      .select('status, refunded, charged_cost, state, result')
      .eq('round_id', ROUND_ID)
      .eq('product', 'open')
      .eq('user_id', userId)
      .maybeSingle()
    const bal3 = await creditsFor(userId)
    console.log('click 3 (cap exceeded):', res3.status, { ok: body3.ok, error: body3.error })
    console.log('row after click 3:', row3.data)
    console.log('credits after click 3 (expect 100 — refunded):', bal3)

    const refundLogs = await supabaseAdmin
      .from('credit_logs')
      .select('module, amount')
      .eq('user_id', userId)
    console.log('credit_logs after cap exceeded:', refundLogs.data)

    const check3 =
      res3.status === 500 &&
      body3.ok === false &&
      row3.data?.status === 'error' &&
      row3.data?.refunded === true &&
      bal3 === 100
    console.log(check3 ? 'PASS B3: retry cap hit -> finishRefund -> 0 net credits lost' : 'FAIL B3: see above')

    return check1 && check2 && check3
  } finally {
    delete process.env[envKey]
    await cleanupUser(userId)
  }
}

async function main() {
  const passA = await scenarioA()
  const passB = await scenarioB()
  console.log(`\n${passA ? 'PASS' : 'FAIL'} Scenario A, ${passB ? 'PASS' : 'FAIL'} Scenario B`)
  if (!passA || !passB) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
