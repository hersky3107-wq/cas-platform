/**
 * Verify script for the 도민 농수산 AI 조업 판단.
 *
 * Runs TWO independent checks:
 *
 *  1. SAFETY-FLOOR UNIT TESTS (always runs, no server needed)
 *     Imports computeSafetyFloor + clampToFloor from the pure
 *     lib/jeju/fishing-floor.ts module (no 'server-only', no Supabase).
 *     Asserts the deterministic clamp with process.exitCode = 1 on any failure.
 *
 *  2. FULL E2E CYCLE (start → poll → result via HTTP, or direct fallback)
 *     Prefers a running Next.js dev server (NEXT_BASE_URL, default
 *     http://localhost:3000). Falls back to calling runFishingDecision() directly
 *     when the server is unreachable (bypasses the job store — no DB needed).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/verify-fishing-decision.ts
 *   npx tsx --env-file=.env.local scripts/verify-fishing-decision.ts 갈치 이호
 */

// ── Static import of the PURE floor module (no server-only) ──────────────────
import { computeSafetyFloor, clampToFloor } from '../lib/jeju/fishing-floor'
import type { FishingDecision } from '../lib/jeju/fishing-floor'

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const species = process.argv[2] ?? '갈치'
const spot    = process.argv[3] ?? '이호'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ── Assertion helpers ─────────────────────────────────────────────────────────

let failCount = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✅ PASS  ${label}`)
  } else {
    console.error(`  ❌ FAIL  ${label}`)
    failCount++
  }
}

// ── Safety-floor unit tests ───────────────────────────────────────────────────

function runFloorTests(): void {
  console.log('\n══ safety-floor unit tests ══')

  const aiGood: FishingDecision = {
    verdict: '나가도 좋음',
    headline: 'AI가 좋다고 함',
    reasons: ['어황 양호'],
    priceNote: '',
    safetyNote: '',
  }
  const aiCaution: FishingDecision = { ...aiGood, verdict: '주의' }
  const base = { waveHeightM: null as number | null, warnings: [] as Array<{ type: string; level: string }> }

  // ── Case 1: 풍랑경보 → forced, AI "나가도 좋음" must clamp to "오늘은 접자" ──
  {
    const marine = { ...base, warnings: [{ type: '풍랑', level: '경보' }] }
    const floor  = computeSafetyFloor(marine)
    const result = clampToFloor(aiGood, floor)
    assert(floor.forced === true,                         'Case 1: 풍랑경보 → floor.forced is true')
    assert(result.verdict === '오늘은 접자',              'Case 1: 풍랑경보 + AI "나가도 좋음" → verdict clamped to "오늘은 접자"')
    assert(result.reasons.some(r => r.includes('풍랑')), 'Case 1: clamp injects 풍랑 reason')
  }

  // ── Case 2: 파고 2.5m → forced, AI "주의" must clamp to "오늘은 접자" ──
  {
    const marine = { ...base, waveHeightM: 2.5 }
    const floor  = computeSafetyFloor(marine)
    const result = clampToFloor(aiCaution, floor)
    assert(floor.forced === true,            'Case 2: 파고 2.5m → floor.forced is true')
    assert(result.verdict === '오늘은 접자', 'Case 2: 파고 2.5m + AI "주의" → verdict clamped to "오늘은 접자"')
    assert(result.reasons.some(r => r.includes('파고')), 'Case 2: clamp injects 파고 reason')
  }

  // ── Case 3: 풍랑주의보만 (no 경보, wave < 2.0m) → NOT forced, AI verdict preserved ──
  {
    const marine = {
      waveHeightM: 0.5,
      warnings: [{ type: '풍랑', level: '주의보' }],
    }
    const floor  = computeSafetyFloor(marine)
    const result = clampToFloor(aiGood, floor)
    assert(floor.forced === false,                  'Case 3: 풍랑주의보만 → floor.forced is false')
    assert(result.verdict === '나가도 좋음',        'Case 3: 주의보 only → AI verdict "나가도 좋음" preserved')
  }

  // ── Case 4: 태풍경보 → forced (checks the DANGER_WARNING_TYPES list) ──
  {
    const marine = { ...base, warnings: [{ type: '태풍', level: '경보' }] }
    const floor  = computeSafetyFloor(marine)
    const result = clampToFloor(aiGood, floor)
    assert(floor.forced === true,            'Case 4: 태풍경보 → floor.forced is true')
    assert(result.verdict === '오늘은 접자', 'Case 4: 태풍경보 + AI "나가도 좋음" → clamped to "오늘은 접자"')
  }

  // ── Case 5: exactly 2.0m (boundary) → forced ──
  {
    const marine = { ...base, waveHeightM: 2.0 }
    const floor  = computeSafetyFloor(marine)
    assert(floor.forced === true, 'Case 5: 파고 exactly 2.0m → floor.forced is true (boundary)')
  }

  // ── Case 6: AI already says "오늘은 접자" with forced floor → no double-wrap ──
  {
    const marine = { ...base, warnings: [{ type: '풍랑', level: '경보' }] }
    const floor  = computeSafetyFloor(marine)
    const already접자: FishingDecision = { ...aiGood, verdict: '오늘은 접자' }
    const result = clampToFloor(already접자, floor)
    assert(result.verdict === '오늘은 접자', 'Case 6: AI already "오늘은 접자" with forced floor → stays "오늘은 접자"')
  }

  const total = 9
  const pass  = total - failCount
  console.log(`\n  ${pass}/${total} passed${failCount > 0 ? ` — ${failCount} FAILED` : ' ✅'}`)
}

// ── E2E cycle ─────────────────────────────────────────────────────────────────

async function viaHttp(): Promise<unknown> {
  const startUrl = `${BASE}/api/domin/fishing-decision/start`
  console.log(`POST ${startUrl}  { species: "${species}", spot: "${spot}" }`)
  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ species, spot }),
    signal: AbortSignal.timeout(15_000),
  })
  const startJson = (await startRes.json()) as { ok?: boolean; jobId?: string; error?: string }
  console.log(`  → HTTP ${startRes.status}`, JSON.stringify(startJson))
  if (!startJson.ok || !startJson.jobId) {
    throw new Error(`start failed: ${startJson.error ?? 'no jobId'}`)
  }

  const jobId     = startJson.jobId
  const statusUrl = `${BASE}/api/domin/fishing-decision/status?jobId=${encodeURIComponent(jobId)}`
  const started   = Date.now()
  for (let i = 0; i < 30; i++) {
    await sleep(3_000)
    const elapsed = Math.round((Date.now() - started) / 1000)
    const res  = await fetch(statusUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    const json = (await res.json()) as { ok?: boolean; status?: string; result?: unknown; error?: string }
    console.log(`  poll ${i + 1} (${elapsed}s): status=${json.status ?? '?'}`)
    if (json.status === 'done')  return json.result
    if (json.status === 'error') throw new Error(`job error: ${json.error ?? 'unknown'}`)
  }
  throw new Error('polling timed out after 90s')
}

async function viaDirect(): Promise<unknown> {
  console.log('(dev server unreachable — calling runFishingDecision() directly)')
  const { runFishingDecision } = await import('../lib/jeju/fishing-decision')
  return runFishingDecision(species, spot)
}

function summarize(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    console.log('Unexpected payload:', payload)
    return
  }
  const p        = payload as Record<string, unknown>
  const decision = (p.decision   ?? {}) as Record<string, unknown>
  const floor    = (p.safetyFloor ?? {}) as Record<string, unknown>
  const meta     = (p.contextMeta ?? {}) as Record<string, unknown>
  const marine   = (p.marine     ?? {}) as Record<string, unknown>
  const fishery  = (p.fishery    ?? {}) as Record<string, unknown>

  console.log('\n── summary ──')
  console.log('ok          :', p.ok)
  console.log('species/spot:', p.species, '/', p.spot)
  console.log('VERDICT     :', p.verdict)
  console.log('headline    :', decision.headline)
  console.log('reasons     :')
  if (Array.isArray(decision.reasons)) {
    for (const r of decision.reasons as string[]) console.log('   •', r)
  }
  console.log('priceNote   :', decision.priceNote)
  console.log('safetyNote  :', decision.safetyNote)
  console.log('\n── safety floor (deterministic) ──')
  console.log('forced      :', floor.forced)
  console.log('reasons     :', floor.reasons)
  console.log('\n── inputs ──')
  console.log('marine.wave :', marine.waveHeightM, 'm')
  console.log('marine.temp :', marine.waterTempC)
  console.log('marine.warn :', Array.isArray(marine.warnings) ? `${(marine.warnings as unknown[]).length} 특보` : marine.warnings)
  console.log('marine.miss :', marine.missing)
  console.log('fishery.src :', fishery.source, '/', fishery.confidence)
  console.log('fishery.late:', fishery.latest == null ? 'null' : JSON.stringify(fishery.latest))
  console.log('\n── contextMeta (provenance) ──')
  console.log('source      :', meta.source)
  console.log('retrievedAt :', meta.retrievedAt)
  console.log('asOf        :', meta.asOf ?? '(null)')
  console.log('\nerrors      :', p.errors)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Always run floor tests first — these never need the server or DB.
  runFloorTests()

  // E2E cycle
  console.log('\n══ e2e cycle ══')
  let payload: unknown
  try {
    payload = await viaHttp()
  } catch (e: unknown) {
    console.warn('HTTP path failed:', e instanceof Error ? e.message : e)
    payload = await viaDirect()
  }

  console.log('\n── full JSON ──')
  console.log(JSON.stringify(payload, null, 2))
  summarize(payload)

  // Exit with 1 if any unit test assertion failed.
  if (failCount > 0) {
    console.error(`\n❌ ${failCount} assertion(s) failed — safety floor broken`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
