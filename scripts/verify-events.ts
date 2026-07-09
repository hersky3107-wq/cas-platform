/**
 * Throwaway verify — GET /api/domin/events. Prints:
 *   - grouped counts (축제 / 공연전시 / 체험강좌 / 도정시정 / 기타)
 *   - the nearest (earliest start) + latest end event dates
 *   - ASSERTS no event with endDate < today survives
 *   - calls twice: force build, then plain GET → confirms cache hit
 *
 * Prefers a running Next.js dev server (NEXT_BASE_URL, default
 * http://localhost:3000). Exits non-zero on any assertion failure.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/verify-events.ts
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const GROUPS = ['축제', '공연전시', '체험강좌', '도정시정', '기타'] as const

async function getEvents(force: boolean): Promise<Record<string, unknown>> {
  const url = `${BASE}/api/domin/events${force ? '?force=1' : ''}`
  console.log(`\nGET ${url}`)
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { Accept: 'application/json' } })
  const text = await res.text()
  console.log(`HTTP ${res.status}`)
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    console.log(text.slice(0, 500))
    throw new Error('Non-JSON response from route')
  }
}

function flatten(groups: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const g of GROUPS) {
    const arr = groups[g]
    if (Array.isArray(arr)) out.push(...(arr as Record<string, unknown>[]))
  }
  return out
}

function summarize(p: Record<string, unknown>): { total: number; violations: number } {
  const today = String(p.today ?? '')
  const groups = (p.groups ?? {}) as Record<string, unknown>
  const meta = (p.contextMeta ?? {}) as Record<string, unknown>

  console.log('\n── summary ──')
  console.log('ok         :', p.ok)
  console.log('today      :', today, '/ windowDays:', p.windowDays)
  console.log('fromCache  :', p.fromCache)
  console.log('errors     :', p.errors)

  let total = 0
  console.log('\n── grouped counts ──')
  for (const g of GROUPS) {
    const arr = Array.isArray(groups[g]) ? (groups[g] as unknown[]) : []
    total += arr.length
    console.log(`  ${g.padEnd(6)} : ${arr.length}`)
    for (const it of arr.slice(0, 3)) {
      const ev = it as Record<string, unknown>
      console.log(
        `      · [${ev.status}] ${ev.startDate ?? '?'}~${ev.endDate ?? '?'}  ` +
        `${String(ev.title).slice(0, 40)}  (${ev.source}${ev.place ? ' · ' + ev.place : ''})`,
      )
    }
  }
  console.log(`  TOTAL  : ${total}`)

  const all = flatten(groups)
  const starts = all.map((e) => String(e.startDate ?? '')).filter(Boolean).sort()
  const ends = all.map((e) => String(e.endDate ?? e.startDate ?? '')).filter(Boolean).sort()
  console.log('\n── date span ──')
  console.log('nearest start :', starts[0] ?? '(none)')
  console.log('latest end    :', ends[ends.length - 1] ?? '(none)')

  // ASSERT: no finished event (endDate < today) survives.
  const violations = all.filter((e) => {
    const end = String(e.endDate ?? e.startDate ?? '')
    return end !== '' && end < today
  })
  console.log('\n── recency assertion ──')
  if (violations.length === 0) {
    console.log(`  PASS — no event with endDate < ${today}`)
  } else {
    console.log(`  FAIL — ${violations.length} finished event(s) leaked:`)
    for (const v of violations.slice(0, 5)) {
      console.log(`    ✗ ${v.endDate} ${v.title}`)
    }
  }

  console.log('\n── contextMeta ──')
  console.log('source      :', meta.source)
  console.log('retrievedAt :', meta.retrievedAt)
  console.log('asOf        :', meta.asOf ?? '(null)')
  console.log('freshness   :', p.freshnessNote)

  return { total, violations: violations.length }
}

async function main(): Promise<void> {
  let failed = false

  // Call 1 — force a fresh build (bypass cache) so we test the live pipeline.
  const first = await getEvents(true)
  console.log('\n===== CALL 1 (force build) =====')
  const r1 = summarize(first)
  if (r1.violations > 0) failed = true

  // Call 2 — plain GET → should hit the cache written by the day's first
  // non-force build. (force=1 does NOT write cache, so warm it first.)
  console.log('\n===== warming cache (plain GET) =====')
  await getEvents(false)
  const second = await getEvents(false)
  console.log('\n===== CALL 2 (expect cache hit) =====')
  const r2 = summarize(second)
  if (r2.violations > 0) failed = true

  console.log('\n── cache check ──')
  if (second.fromCache === true) {
    console.log('  PASS — 2nd plain GET served fromCache=true')
  } else {
    console.log('  WARN — 2nd GET fromCache=false (migration applied? table exists?)')
  }

  if (failed) {
    console.error('\nRESULT: FAIL — finished events leaked past the recency filter.')
    process.exit(1)
  }
  console.log('\nRESULT: PASS')
}

main().catch((e) => { console.error(e); process.exit(1) })
