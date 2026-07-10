/**
 * Throwaway verify — calls GET /api/domin/news TWICE and prints:
 *   - each item's asOf (article date) + source
 *   - total item count + per-category counts + oldest asOf
 *     (must be within last 3 KST days)
 *   - cache hit vs perplexity fetch on the second call
 *   - a neutrality heuristic scan of 정치·도정 items (flags evaluative
 *     wording for manual review — does not replace human judgment)
 *
 * Prefers a running Next.js dev server (NEXT_BASE_URL, default
 * http://localhost:3000). Falls back to calling getNews() directly.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/verify-news.ts
 *   npx tsx --env-file=.env.local scripts/verify-news.ts --force
 *
 * Direct fallback:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/verify-news.ts
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const FORCE = process.argv.includes('--force')

async function viaHttp(force: boolean): Promise<unknown> {
  const qs = force ? '?force=1' : ''
  const url = `${BASE}/api/domin/news${qs}`
  console.log(`GET ${url}`)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: 'application/json' },
  })
  const text = await res.text()
  console.log(`HTTP ${res.status}`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    console.log(text.slice(0, 500))
    throw new Error('Non-JSON response from route')
  }
}

async function viaDirect(force: boolean): Promise<unknown> {
  console.log(`(dev server unreachable — calling getNews({ force: ${force} }) directly)`)
  const { getNews } = await import('../lib/jeju/news')
  return getNews({ force })
}

async function fetchOnce(force: boolean): Promise<Record<string, unknown>> {
  let payload: unknown
  try {
    payload = await viaHttp(force)
  } catch (e: unknown) {
    console.warn('HTTP path failed:', e instanceof Error ? e.message : e)
    payload = await viaDirect(force)
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Unexpected payload')
  }
  return payload as Record<string, unknown>
}

function oldestAsOf(briefing: Record<string, unknown>[]): string | null {
  const dates = briefing
    .map((i) => (typeof i.asOf === 'string' ? i.asOf : null))
    .filter((d): d is string => Boolean(d))
    .sort()
  return dates.length ? dates[0]! : null
}

function newestAsOf(briefing: Record<string, unknown>[]): string | null {
  const dates = briefing
    .map((i) => (typeof i.asOf === 'string' ? i.asOf : null))
    .filter((d): d is string => Boolean(d))
    .sort()
  return dates.length ? dates[dates.length - 1]! : null
}

function daysAgo(ymd: string, todayYmd: string): number | null {
  const a = Date.parse(`${ymd}T00:00:00Z`)
  const b = Date.parse(`${todayYmd}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}

/**
 * Heuristic-only neutrality scan for 정치·도정 items: flags evaluative /
 * advocacy wording (판단·평가·옹호 표현) so a human can double-check. This is
 * NOT a substitute for reading the items — Perplexity/Claude wording nuance
 * can slip past a keyword list either way.
 */
const EVALUATIVE_WORDS = [
  '잘했다', '잘한', '옳다', '옳은', '실패', '무능', '훌륭', '뛰어난',
  '최악', '최고', '어리석', '부당', '정당하다', '올바른', '그르다',
  '비판받아야', '환영할', '유감스럽', '충격적', '경악',
]

function scanNeutrality(briefing: Record<string, unknown>[]): { headline: string; hits: string[] }[] {
  const flagged: { headline: string; hits: string[] }[] = []
  for (const it of briefing) {
    if (String(it.category ?? '') !== '정치·도정') continue
    const text = `${it.headline ?? ''} ${it.summary ?? ''} ${it.why ?? ''}`
    const hits = EVALUATIVE_WORDS.filter((w) => text.includes(w))
    if (hits.length > 0) flagged.push({ headline: String(it.headline ?? ''), hits })
  }
  return flagged
}

function summarize(label: string, p: Record<string, unknown>): void {
  const briefing = Array.isArray(p.briefing) ? (p.briefing as Record<string, unknown>[]) : []
  const meta = (p.contextMeta ?? {}) as Record<string, unknown>
  const fromCache = Boolean(p.fromCache)
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const oldest = oldestAsOf(briefing)
  const newest = newestAsOf(briefing)

  console.log(`\n══ ${label} ══`)
  console.log(fromCache ? '→ CACHE HIT' : '→ PERPLEXITY FETCH')
  console.log('ok           :', p.ok)
  console.log('fromCache    :', fromCache)
  console.log('TOTAL items  :', briefing.length)
  console.log('oldest asOf  :', oldest ?? '(none)', oldest ? `(${daysAgo(oldest, today)}d ago)` : '')
  console.log('newest asOf  :', newest ?? '(none)')
  console.log('freshness    :', p.freshnessNote)
  console.log('errors       :', p.errors)

  const oldestAge = oldest ? daysAgo(oldest, today) : null
  const recencyOk = briefing.length === 0 || (oldestAge !== null && oldestAge >= 0 && oldestAge <= 3)
  console.log(
    'oldest ≤3d   :',
    recencyOk ? 'PASS' : 'FAIL',
    oldestAge !== null ? `(oldest is ${oldestAge}d old)` : '(no items)'
  )

  console.log('\n── contextMeta ──')
  console.log('source      :', meta.source)
  console.log('retrievedAt :', meta.retrievedAt)
  console.log('asOf        :', meta.asOf ?? '(null)')

  // Recency assertion
  let stale = 0
  let undated = 0
  for (const it of briefing) {
    if (typeof it.asOf !== 'string') {
      undated++
      continue
    }
    const age = daysAgo(it.asOf, today)
    if (age == null || age < 0 || age > 3) stale++
  }
  console.log('\n── recency check ──')
  console.log('undated    :', undated, undated === 0 ? 'PASS' : 'FAIL')
  console.log('>3 days old:', stale, stale === 0 ? 'PASS' : 'FAIL')

  console.log('\n── briefing ──')
  if (briefing.length === 0) {
    console.log('(empty)')
    return
  }

  const byCat = new Map<string, number>()
  for (const [i, it] of briefing.entries()) {
    const cat = String(it.category ?? '?')
    byCat.set(cat, (byCat.get(cat) ?? 0) + 1)
    console.log(`\n[${i + 1}] ${cat}`)
    console.log(`  headline : ${it.headline}`)
    console.log(`  asOf     : ${it.asOf ?? '(null)'}  ← article date`)
    console.log(`  source   : ${it.source ?? '(null)'}`)
    console.log(`  why      : ${it.why}`)
    console.log(`  summary  : ${String(it.summary ?? '').slice(0, 160)}${String(it.summary ?? '').length > 160 ? '…' : ''}`)
  }

  console.log('\n── per-category counts ──')
  for (const [cat, n] of byCat) console.log(`  ${cat}: ${n}`)

  const flagged = scanNeutrality(briefing)
  console.log('\n── 정치·도정 neutrality scan (heuristic — verify by eye) ──')
  const politicalCount = byCat.get('정치·도정') ?? 0
  console.log(`정치·도정 items: ${politicalCount}`)
  if (politicalCount === 0) {
    console.log('(none this run — nothing to check)')
  } else if (flagged.length === 0) {
    console.log('no evaluative keywords detected — PASS (still read items manually)')
  } else {
    console.log(`⚠ ${flagged.length} item(s) contain possible evaluative wording — review:`)
    for (const f of flagged) console.log(`  - "${f.headline}" → matched: ${f.hits.join(', ')}`)
  }
}

async function main(): Promise<void> {
  // Call 1: force refresh if --force, else normal (may hit yesterday's empty or today's cache)
  console.log('── call 1 ──')
  const first = await fetchOnce(FORCE)
  summarize('CALL 1', first)

  // Call 2: must be cache hit if call 1 wrote today's row (skip if force-only single run)
  console.log('\n── call 2 (expect CACHE HIT) ──')
  const second = await fetchOnce(false)
  summarize('CALL 2', second)

  if (second.fromCache) {
    console.log('\n✓ second call was a CACHE HIT — daily caching works')
  } else {
    console.log('\n⚠ second call was NOT a cache hit — is jeju_news_cache migration applied?')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
