/**
 * SECURITY VERIFICATION for the public (logged-in) league path.
 *
 * Exercises the real HTTP routes against the running dev server with a REAL,
 * throwaway non-admin session, plus direct calls into the server modules for
 * the two things an HTTP probe cannot show without spending money (admin
 * credit bypass, admin jurisdiction bypass).
 *
 * It never triggers a successful paid run: every paid probe is arranged to be
 * refused (403 / 402 / 429) before the orchestrator is reached, so this script
 * costs zero provider spend and zero credits.
 *
 * Creates and DELETES two throwaway auth users and one temporary unresolved
 * round (used to prove category-level jurisdiction gating end to end). Cleanup
 * runs in a finally block.
 *
 * Run (dev server must be up):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-league-public-access.ts
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../lib/supabase/server'
import { deductCreditsBalance, getCreditsBalance } from '../lib/credits-server'
import { ADMIN_EMAIL, LEAGUE_GENERATE_CREDITS } from '../lib/credits'
import {
  authorizeRoundForViewer,
  viewerCanSeeCategory,
  viewerInstruments,
  type LeagueViewer,
} from '../lib/league/public-access'
import { visibleCategoriesFor } from '../lib/league/access-policy'
import { CATALOG_INSTRUMENT_IDS, PUBLIC_CATEGORY_IDS } from '../lib/league/catalog'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`)
  }
}

type Probe = { status: number; body: Record<string, unknown> }

async function probe(
  path: string,
  opts: { token?: string; method?: 'GET' | 'POST'; json?: unknown } = {}
): Promise<Probe> {
  const headers: Record<string, string> = {}
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = { raw: text.slice(0, 200) }
  }
  return { status: res.status, body }
}

const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

type TestUser = { id: string; email: string; token: string }

async function createTestUser(tag: string, credits: number, declaredCountry: string | null): Promise<TestUser> {
  const email = `league-verify-${tag}-${Date.now()}@example.com`
  const password = `Vf-${Math.random().toString(36).slice(2)}-${Date.now()}`
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)

  await supabaseAdmin
    .from('users')
    .upsert({ id: data.user.id, credits, declared_country: declaredCountry }, { onConflict: 'id' })

  const signIn = await anon.auth.signInWithPassword({ email, password })
  if (signIn.error || !signIn.data.session) throw new Error(`signIn failed: ${signIn.error?.message}`)

  return { id: data.user.id, email, token: signIn.data.session.access_token }
}

async function setCountry(userId: string, country: string | null): Promise<void> {
  await supabaseAdmin.from('users').update({ declared_country: country }).eq('id', userId)
}

async function countPredictions(roundId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('model_predictions')
    .select('round_id', { count: 'exact', head: true })
    .eq('round_id', roundId)
  return count ?? 0
}

async function countRounds(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id', { count: 'exact', head: true })
  return count ?? 0
}

async function main() {
  const createdUsers: string[] = []
  let tempRoundId: string | null = null

  try {
    // ── Fixtures from the real ledger ────────────────────────────────────────
    const { data: ranked } = await supabaseAdmin
      .from('prediction_rounds')
      .select('id, instrument, category, item_type')
      .eq('item_type', 'ranked')
      .eq('instrument', 'AAPL')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data: onDemand } = await supabaseAdmin
      .from('prediction_rounds')
      .select('id, instrument, category, item_type')
      .eq('item_type', 'on_demand')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!ranked || !onDemand) throw new Error('need one ranked AAPL round and one on_demand round in the ledger')
    const rankedId = (ranked as { id: string }).id
    const onDemandId = (onDemand as { id: string }).id
    console.log(`Fixtures: ranked=${rankedId}  on_demand=${onDemandId}\n`)

    // A temporary RANKED round in a category that some jurisdictions block, so
    // category-level gating can be proven end to end (no such round exists in
    // the ledger today — the league is all-finance). Unresolved and far in the
    // future, so no cron/reconciler will ever touch it; deleted in cleanup.
    const { data: tempRound, error: tempErr } = await supabaseAdmin
      .from('prediction_rounds')
      .insert({
        proposition_text: '[verification fixture] BTC/USD perpetual direction',
        category: 'crypto_perps',
        color_bucket: 'yellow',
        item_type: 'ranked',
        instrument: 'BTC/USD',
        horizon: '24h',
        resolution_rule: 'verification fixture — never resolved',
        resolves_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
      })
      .select('id')
      .single()
    if (tempErr || !tempRound) throw new Error(`temp round insert failed: ${tempErr?.message}`)
    tempRoundId = (tempRound as { id: string }).id

    const userA = await createTestUser('a', 100, 'KR')
    createdUsers.push(userA.id)
    const userB = await createTestUser('b', 0, 'KR')
    createdUsers.push(userB.id)
    console.log(`Test users: A=${userA.email} (100 credits)  B=${userB.email} (0 credits)\n`)

    // ── 1. Unauthenticated callers ───────────────────────────────────────────
    console.log('1) UNAUTHENTICATED — every league route must refuse')
    for (const path of [
      '/api/league/card?instrument=AAPL',
      '/api/league/leaderboard',
      '/api/league/record-room',
      '/api/league/instruments',
    ]) {
      const r = await probe(path)
      check(`GET ${path} -> 401`, r.status === 401, `got ${r.status}`)
    }
    const anonGen = await probe('/api/league/generate-stream', { method: 'POST', json: { roundId: rankedId } })
    check('POST generate-stream (no session) -> 401', anonGen.status === 401, `got ${anonGen.status}`)

    // ── 2. Logged-in non-admin: FREE reads ───────────────────────────────────
    console.log('\n2) NON-ADMIN FREE READS (declared_country=KR, 100 credits)')
    const creditsBeforeReads = await getCreditsBalance(supabaseAdmin, userA.id)

    const instruments = await probe('/api/league/instruments', { token: userA.token })
    const categoryList = (instruments.body.categories ?? []) as { id: string }[]
    check('GET instruments -> 200', instruments.status === 200, `got ${instruments.status}`)
    check(
      '12-category catalog returned',
      categoryList.length === PUBLIC_CATEGORY_IDS.length,
      categoryList.map((c) => c.id).join(','),
    )

    const card = await probe('/api/league/card?instrument=AAPL', { token: userA.token })
    check('GET card?instrument=AAPL -> 200', card.status === 200, `got ${card.status}`)

    const cardById = await probe(`/api/league/card?round_id=${rankedId}`, { token: userA.token })
    check('GET card?round_id=<ranked> -> 200', cardById.status === 200, `got ${cardById.status}`)

    const lb = await probe('/api/league/leaderboard', { token: userA.token })
    check('GET leaderboard -> 200', lb.status === 200, `got ${lb.status}`)
    check(
      'leaderboard has data for an allowed jurisdiction',
      (lb.body.totalConsidered as number) > 0,
      `totalConsidered=${lb.body.totalConsidered}`
    )

    const rr = await probe('/api/league/record-room?page=1&pageSize=5', { token: userA.token })
    const rrRounds = (rr.body.rounds ?? []) as { round_id: string; item_type?: string }[]
    check('GET record-room (free summary) -> 200', rr.status === 200, `got ${rr.status}`)
    const rrDeepDenied = await probe('/api/league/record-room?page=1&pageSize=20', { token: userA.token })
    check(
      'GET record-room pageSize=20 -> 403 deep_archive_required',
      rrDeepDenied.status === 403 && rrDeepDenied.body.code === 'deep_archive_required',
      `got ${rrDeepDenied.status} ${rrDeepDenied.body.code ?? ''}`
    )
    check('record room returns the ranked history', rrRounds.length > 0, `${rrRounds.length} rounds`)
    check(
      'record room hides on-demand rounds from non-admin',
      rrRounds.length > 0 && !rrRounds.some((e) => e.round_id === onDemandId),
      rrRounds.map((e) => e.round_id.slice(0, 8)).join(',')
    )

    const creditsAfterReads = await getCreditsBalance(supabaseAdmin, userA.id)
    check(
      'reads charged nothing',
      creditsBeforeReads === creditsAfterReads,
      `${creditsBeforeReads} -> ${creditsAfterReads}`
    )

    // ── 3. Curated-only enforcement ──────────────────────────────────────────
    console.log('\n3) CURATED-ONLY (no on-demand / arbitrary instrument search)')
    const tsla = await probe('/api/league/card?instrument=TSLA', { token: userA.token })
    check('GET card?instrument=TSLA -> 403', tsla.status === 403, `got ${tsla.status} ${tsla.body.code ?? ''}`)

    const odCard = await probe(`/api/league/card?round_id=${onDemandId}`, { token: userA.token })
    check(
      'GET card?round_id=<on_demand> -> 403',
      odCard.status === 403,
      `got ${odCard.status} ${odCard.body.code ?? ''}`
    )

    const roundsBeforeArbitrary = await countRounds()
    const arbitrary = await probe('/api/league/generate-stream', {
      token: userA.token,
      method: 'POST',
      json: {
        round: {
          proposition_text: 'attacker-supplied proposition',
          category: 'stock',
          instrument: 'TSLA',
          horizon: '24h',
          resolution_rule: 'whatever',
          resolves_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
    })
    const roundsAfterArbitrary = await countRounds()
    check(
      'POST generate-stream { round: ... } (arbitrary) -> 403',
      arbitrary.status === 403,
      `got ${arbitrary.status} ${arbitrary.body.code ?? ''}`
    )
    check(
      'refused arbitrary round created no ledger row',
      roundsAfterArbitrary === roundsBeforeArbitrary,
      `${roundsBeforeArbitrary} -> ${roundsAfterArbitrary}`
    )
    const creditsAfterArbitrary = await getCreditsBalance(supabaseAdmin, userA.id)
    check(
      'refused arbitrary round charged nothing',
      creditsAfterArbitrary === creditsAfterReads,
      `${creditsAfterArbitrary}`
    )

    // ── 4. Jurisdiction gating at the API level ──────────────────────────────
    console.log('\n4) JURISDICTION GATE (server-side, not just UI)')

    // 4a. Category-level: crypto_perps is allowed in US, blocked in UK.
    const permsUs = await probe(
      `/api/league/card?round_id=${tempRoundId}&dev_declared_country=US&dev_ip_country=US`,
      { token: userA.token }
    )
    check('crypto_perps round, US viewer -> 200', permsUs.status === 200, `got ${permsUs.status}`)

    const permsGb = await probe(
      `/api/league/card?round_id=${tempRoundId}&dev_declared_country=US&dev_ip_country=GB`,
      { token: userA.token }
    )
    check(
      'same round, IP=GB -> 403 jurisdiction_blocked (stricter-of-two)',
      permsGb.status === 403 && permsGb.body.code === 'jurisdiction_blocked',
      `got ${permsGb.status} ${permsGb.body.code ?? ''}`
    )

    const permsGbGen = await probe(
      `/api/league/generate-stream?dev_declared_country=US&dev_ip_country=GB`,
      { token: userA.token, method: 'POST', json: { roundId: tempRoundId } }
    )
    const creditsAfterBlockedGen = await getCreditsBalance(supabaseAdmin, userA.id)
    check(
      'PAID generate on a blocked category -> 403',
      permsGbGen.status === 403,
      `got ${permsGbGen.status} ${permsGbGen.body.code ?? ''}`
    )
    check(
      'blocked generate charged nothing',
      creditsAfterBlockedGen === creditsAfterReads,
      `${creditsAfterBlockedGen}`
    )

    // 4b. Whole-jurisdiction: declared_country=CN denies every category, and it
    //     comes from the DB — no dev query parameter involved.
    await setCountry(userA.id, 'CN')
    const cnCard = await probe('/api/league/card?instrument=AAPL', { token: userA.token })
    check(
      'declared_country=CN, GET card -> 403 jurisdiction_blocked',
      cnCard.status === 403 && cnCard.body.code === 'jurisdiction_blocked',
      `got ${cnCard.status} ${cnCard.body.code ?? ''}`
    )
    const cnInstruments = await probe('/api/league/instruments', { token: userA.token })
    check(
      'CN viewer gets an empty category catalog',
      ((cnInstruments.body.categories ?? []) as unknown[]).length === 0,
      `got ${JSON.stringify(cnInstruments.body).slice(0, 80)}`
    )
    const cnLb = await probe('/api/league/leaderboard', { token: userA.token })
    check(
      'CN viewer leaderboard is empty, not partial',
      cnLb.status === 200 && cnLb.body.totalConsidered === 0,
      `status=${cnLb.status} totalConsidered=${cnLb.body.totalConsidered}`
    )
    const cnRr = await probe('/api/league/record-room', { token: userA.token })
    check(
      'CN viewer record room is empty',
      cnRr.status === 200 && ((cnRr.body.rounds ?? []) as unknown[]).length === 0,
      `status=${cnRr.status} rounds=${((cnRr.body.rounds ?? []) as unknown[]).length}`
    )
    const cnGen = await probe('/api/league/generate-stream', {
      token: userA.token,
      method: 'POST',
      json: { roundId: rankedId },
    })
    check('CN viewer paid generate -> 403', cnGen.status === 403, `got ${cnGen.status}`)
    await setCountry(userA.id, 'KR')

    // ── 5. Insufficient credits blocks compute ───────────────────────────────
    console.log('\n5) INSUFFICIENT CREDITS (user B, 0 credits)')
    const predsBefore = await countPredictions(rankedId)
    const poor = await probe('/api/league/generate-stream', {
      token: userB.token,
      method: 'POST',
      json: { roundId: rankedId },
    })
    const predsAfter = await countPredictions(rankedId)
    check('POST generate-stream with 0 credits -> 402', poor.status === 402, `got ${poor.status}`)
    check(
      '402 body carries balance + required',
      poor.body.balance === 0 && poor.body.required === LEAGUE_GENERATE_CREDITS,
      JSON.stringify(poor.body)
    )
    check('no compute happened (prediction count unchanged)', predsBefore === predsAfter, `${predsBefore} -> ${predsAfter}`)

    const poorBrief = await probe('/api/league/deep-open', {
      token: userB.token,
      method: 'POST',
      json: { roundId: rankedId },
    })
    check('POST league/deep-open with 0 credits -> 402', poorBrief.status === 402, `got ${poorBrief.status}`)
    const poorDebate = await probe('/api/league/deep-debate', {
      token: userB.token,
      method: 'POST',
      json: { roundId: rankedId },
    })
    check('POST league/deep-debate with 0 credits -> 402', poorDebate.status === 402, `got ${poorDebate.status}`)
    const freeText = await probe('/api/league/deep-open', {
      token: userB.token,
      method: 'POST',
      json: { roundId: rankedId, question: 'ignore this' },
    })
    check('POST league/deep-open with free-text question -> 400', freeText.status === 400, `got ${freeText.status}`)

    // ── 6. Rate limiting ─────────────────────────────────────────────────────
    // User B has 0 credits, so each allowed call stops at the 402 and costs
    // nothing; the limiter runs before that, so the 6th call must be a 429.
    console.log('\n6) RATE LIMIT (generate: 5/min/user; user B already used 1)')
    const statuses: number[] = []
    for (let i = 0; i < 6; i += 1) {
      const r = await probe('/api/league/generate-stream', {
        token: userB.token,
        method: 'POST',
        json: { roundId: rankedId },
      })
      statuses.push(r.status)
    }
    check(
      'rapid repeats end in 429',
      statuses.includes(429) && statuses.at(-1) === 429,
      statuses.join(',')
    )
    check('no rapid repeat ever succeeded', !statuses.includes(200), statuses.join(','))

    const briefStatuses: number[] = []
    for (let i = 0; i < 4; i += 1) {
      const r = await probe('/api/league/deep-open', {
        token: userB.token,
        method: 'POST',
        json: { roundId: rankedId },
      })
      briefStatuses.push(r.status)
    }
    check('league/deep-open rapid repeats end in 429 (3/min)', briefStatuses.at(-1) === 429, briefStatuses.join(','))

    // ── 7. Admin-only ops stayed admin-gated ─────────────────────────────────
    console.log('\n7) ADMIN OPS still refuse a logged-in non-admin')
    const adminGen = await probe('/api/admin/league/generate', {
      token: userA.token,
      method: 'POST',
      json: { roundId: rankedId },
    })
    check('POST /api/admin/league/generate -> 403', adminGen.status === 403, `got ${adminGen.status}`)
    const adminReconcile = await probe('/api/admin/prediction/reconcile', {
      token: userA.token,
      method: 'POST',
      json: {},
    })
    check('POST /api/admin/prediction/reconcile -> 403', adminReconcile.status === 403, `got ${adminReconcile.status}`)
    // Cron routes verify CRON_SECRET, not a user session: 401 on a bad secret,
    // 503 when the secret is not configured at all (the case in local dev).
    // Both are refusals — the important part is that a user JWT never gets in.
    const cronRefusals = [401, 403, 503]
    const cronOpen = await probe('/api/cron/league/open', { token: userA.token, method: 'POST', json: {} })
    check(
      'POST /api/cron/league/open (user token, no cron secret) refused',
      cronRefusals.includes(cronOpen.status),
      `got ${cronOpen.status} ${JSON.stringify(cronOpen.body).slice(0, 60)}`
    )
    const cronReconcile = await probe('/api/cron/prediction/reconcile', {
      token: userA.token,
      method: 'POST',
      json: {},
    })
    check(
      'POST /api/cron/prediction/reconcile (user token) refused',
      cronRefusals.includes(cronReconcile.status),
      `got ${cronReconcile.status} ${JSON.stringify(cronReconcile.body).slice(0, 60)}`
    )

    // ── 8. Admin bypass still intact ─────────────────────────────────────────
    // Verified directly against the real modules: an HTTP probe of the admin's
    // paid path would run the roster and cost real money.
    console.log('\n8) ADMIN BYPASS (direct module checks — no provider spend)')
    const { data: adminList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const adminUser = adminList?.users.find((u) => (u.email ?? '').toLowerCase() === ADMIN_EMAIL.toLowerCase())
    if (!adminUser) {
      check('admin account found', false, 'not in the first 200 users')
    } else {
      const before = await getCreditsBalance(supabaseAdmin, adminUser.id)
      const deduct = await deductCreditsBalance(supabaseAdmin, adminUser.id, LEAGUE_GENERATE_CREDITS, 'league_generate')
      const after = await getCreditsBalance(supabaseAdmin, adminUser.id)
      check(
        'admin credit deduction is skipped',
        deduct.ok && deduct.skipped === true,
        JSON.stringify(deduct)
      )
      check('admin balance unchanged', before === after, `${before} -> ${after}`)
    }

    const adminViewer: LeagueViewer = {
      userId: 'admin-test',
      email: ADMIN_EMAIL,
      isAdmin: true,
      jurisdiction: { declaredCountry: 'CN', ipCountry: 'CN' },
      visibleCategories: visibleCategoriesFor({ declaredCountry: 'CN', ipCountry: 'CN' }),
    }
    const publicViewer: LeagueViewer = { ...adminViewer, isAdmin: false }
    check('admin sees a category denied by their jurisdiction', viewerCanSeeCategory(adminViewer, 'stock'), 'CN admin')
    check('non-admin does not', !viewerCanSeeCategory(publicViewer, 'stock'), 'CN non-admin')
    check(
      'admin instrument list is not jurisdiction-filtered',
      viewerInstruments(adminViewer).length === CATALOG_INSTRUMENT_IDS.length,
    )
    check('non-admin instrument list is', viewerInstruments(publicViewer).length === 0)

    const adminOnDemand = await authorizeRoundForViewer(adminViewer, onDemandId)
    const publicOnDemand = await authorizeRoundForViewer(publicViewer, onDemandId)
    check('admin may target an on-demand round', adminOnDemand.ok)
    check('non-admin may not', !publicOnDemand.ok)
  } finally {
    console.log('\nCleanup')
    if (tempRoundId) {
      await supabaseAdmin.from('prediction_rounds').delete().eq('id', tempRoundId)
      console.log(`  removed temp round ${tempRoundId}`)
    }
    for (const id of createdUsers) {
      await supabaseAdmin.from('users').delete().eq('id', id)
      await supabaseAdmin.auth.admin.deleteUser(id)
      console.log(`  removed test user ${id}`)
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verification crashed:', e)
  process.exit(1)
})
