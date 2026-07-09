/**
 * Throwaway verify — calls GET /api/domin/fishery-price and prints the JSON.
 *
 * Prefers a running Next.js dev server (NEXT_BASE_URL, default
 * http://localhost:3000). Falls back to calling getFisheryPrice() directly
 * when the server is unreachable, so you can still inspect upstream shapes.
 *
 * Run (with `npm run dev` in another terminal):
 *   npx tsx --env-file=.env.local scripts/verify-fishery.ts
 *   npx tsx --env-file=.env.local scripts/verify-fishery.ts 갈치
 *   npx tsx --env-file=.env.local scripts/verify-fishery.ts "한치(살오징어)" 7
 *
 * Direct fallback (no Next server) needs the server-only stub:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/verify-fishery.ts 갈치
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const species = process.argv[2] ?? '갈치'
const days = process.argv[3] ?? ''

async function viaHttp(): Promise<unknown> {
  const params = new URLSearchParams({ species })
  if (days) params.set('days', days)
  const url = `${BASE}/api/domin/fishery-price?${params.toString()}`
  console.log(`GET ${url}`)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(45_000),
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

async function viaDirect(): Promise<unknown> {
  console.log('(dev server unreachable — calling getFisheryPrice() directly)')
  const { getFisheryPrice } = await import('../lib/jeju/fishery')
  return getFisheryPrice(species, days || null)
}

function summarize(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    console.log('Unexpected payload:', payload)
    return
  }
  const p = payload as Record<string, unknown>
  console.log('\n── summary ──')
  console.log('ok         :', p.ok)
  console.log('species    :', p.species)
  console.log('source     :', p.source)
  console.log('confidence :', p.confidence)
  console.log('latest     :', p.latest == null ? 'null' : JSON.stringify(p.latest))
  console.log(
    'trend      :',
    Array.isArray(p.trend) ? `${(p.trend as unknown[]).length} point(s)` : p.trend,
  )
  if (Array.isArray(p.trend) && p.trend.length > 0) {
    for (const pt of p.trend as Record<string, unknown>[]) {
      console.log(
        `   ${pt.date}  avg=${pt.avgPrice ?? '—'}  vol=${pt.volumeKg ?? '—'}`,
      )
    }
  }
  console.log('freshness  :', p.freshnessNote)
  console.log('errors     :', p.errors)
  console.log('updatedAt  :', p.updatedAt)
  console.log('\n── context (Perplexity enrichment) ──')
  console.log(typeof p.context === 'string' && p.context ? p.context : '(none)')
  console.log('\n── contextMeta ──')
  if (p.contextMeta && typeof p.contextMeta === 'object') {
    const m = p.contextMeta as Record<string, unknown>
    console.log('source     :', m.source)
    console.log('retrievedAt:', m.retrievedAt)
    console.log('asOf       :', m.asOf ?? '(null)')
  } else {
    console.log('(missing)')
  }
}

async function main(): Promise<void> {
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
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
