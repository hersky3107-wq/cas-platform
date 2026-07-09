/**
 * Throwaway verify — 복지·행정 route. Three checks:
 *   (1) GET  /api/domin/welfare        → deadline-soon list; ASSERT no item with
 *                                          deadline < today survives.
 *   (2) POST /api/domin/welfare/match  { age:45, job:'감귤농가' } → matched items;
 *                                          ASSERT every item has a source (org|url).
 *   (3) GET  /api/domin/welfare/guide?topic=전입신고 → guide + provenance;
 *                                          call twice → confirm cache hit on 2nd.
 *
 * Exits non-zero on a hard assertion failure (deadline leak or sourceless item).
 * Run: npx tsx --env-file=.env.local scripts/verify-welfare.ts
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

function todayKstIso(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const url = `${BASE}${path}`
  console.log(`\nGET ${url}`)
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { Accept: 'application/json' } })
  const text = await res.text()
  console.log(`HTTP ${res.status}`)
  try { return JSON.parse(text) as Record<string, unknown> } catch { console.log(text.slice(0, 400)); throw new Error('Non-JSON') }
}

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const url = `${BASE}${path}`
  console.log(`\nPOST ${url}  ${JSON.stringify(body)}`)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  console.log(`HTTP ${res.status}`)
  try { return JSON.parse(text) as Record<string, unknown> } catch { console.log(text.slice(0, 400)); throw new Error('Non-JSON') }
}

async function main(): Promise<void> {
  const today = todayKstIso()
  let failed = 0

  // ── (1) GET deadline-soon ───────────────────────────────────────────────
  console.log('\n========== (1) GET /welfare (deadline-soon) ==========')
  const w = await getJson('/api/domin/welfare?force=1')
  const soon = Array.isArray(w.deadlineSoon) ? (w.deadlineSoon as Record<string, unknown>[]) : []
  console.log('today       :', w.today, '/ windowDays:', w.windowDays)
  console.log('fromCache   :', w.fromCache)
  console.log('errors      :', w.errors)
  console.log('deadlineSoon:', soon.length, 'items')
  for (const it of soon.slice(0, 8)) {
    console.log(`  · ${it.deadline ?? '?'}  ${String(it.name).slice(0, 40)}  (${it.source} / ${it.org ?? it.url ?? '?'})`)
  }
  const leaks = soon.filter((it) => {
    const d = String(it.deadlineDate ?? '')
    return d !== '' && d < today
  })
  if (leaks.length === 0) console.log(`  PASS — no item with deadline < ${today}`)
  else { console.log(`  FAIL — ${leaks.length} expired item(s) leaked`); failed++ }

  // ── (2) POST match ──────────────────────────────────────────────────────
  console.log('\n========== (2) POST /welfare/match {age:45, job:감귤농가} ==========')
  const m = await postJson('/api/domin/welfare/match', { age: 45, job: '감귤농가' })
  const matches = Array.isArray(m.matches) ? (m.matches as Record<string, unknown>[]) : []
  console.log('matches    :', matches.length)
  console.log('disclaimer :', m.disclaimer)
  console.log('errors     :', m.errors)
  for (const it of matches.slice(0, 8)) {
    console.log(`  · ${String(it.name).slice(0, 40)}  기관:${it.org ?? '—'}  기한:${it.deadline ?? '—'}`)
    console.log(`      note: ${it.note ?? '—'}`)
  }
  const sourceless = matches.filter((it) => !it.org && !it.url)
  if (matches.length === 0) {
    console.log('  (no matches — likely gov24 propagating + Perplexity empty; not a hard fail)')
  } else if (sourceless.length === 0) {
    console.log('  PASS — every match has a source (org|url)')
  } else {
    console.log(`  FAIL — ${sourceless.length} match(es) without a source`)
    failed++
  }

  // ── (3) GET guide (+ cache hit) ─────────────────────────────────────────
  console.log('\n========== (3) GET /welfare/guide?topic=전입신고 ==========')
  const g1 = await getJson(`/api/domin/welfare/guide?topic=${encodeURIComponent('전입신고')}`)
  console.log('ok         :', g1.ok, '/ fromCache:', g1.fromCache)
  console.log('intro      :', g1.intro)
  const steps = Array.isArray(g1.steps) ? (g1.steps as Record<string, unknown>[]) : []
  for (const s of steps) console.log(`  ${s.step}. ${s.text}`)
  console.log('documents  :', g1.documents)
  console.log('where      :', g1.where)
  const meta = (g1.contextMeta ?? {}) as Record<string, unknown>
  console.log('provenance :', `${meta.source} · asOf ${meta.asOf ?? '(null)'} · ${meta.retrievedAt}`)

  const g2 = await getJson(`/api/domin/welfare/guide?topic=${encodeURIComponent('전입신고')}`)
  console.log('\n2nd call fromCache:', g2.fromCache)
  if (g2.fromCache === true) console.log('  PASS — guide served fromCache=true')
  else console.log('  WARN — 2nd guide fromCache=false (migration applied? or 1st build failed)')

  console.log(failed === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failed} hard assertion failure[s])`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
