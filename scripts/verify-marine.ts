/**
 * Throwaway verify — calls GET /api/domin/marine and prints the JSON.
 *
 * Prefers a running Next.js dev server (NEXT_BASE_URL, default
 * http://localhost:3000). Falls back to calling getMarineData() directly
 * when the server is unreachable, so you can still inspect upstream shapes.
 *
 * Run (with `npm run dev` in another terminal):
 *   npx tsx --env-file=.env.local scripts/verify-marine.ts
 *   npx tsx --env-file=.env.local scripts/verify-marine.ts 협재
 *   npx tsx --env-file=.env.local scripts/verify-marine.ts 348
 *
 * Direct fallback (no Next server) needs the server-only stub:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/verify-marine.ts
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const spot = process.argv[2] ?? ''

async function viaHttp(): Promise<unknown> {
  const q = spot ? `?spot=${encodeURIComponent(spot)}` : ''
  const url = `${BASE}/api/domin/marine${q}`
  console.log(`GET ${url}`)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(35_000),
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
  console.log('(dev server unreachable — calling getMarineData() directly)')
  // Dynamic import so the script still typechecks when run outside Next.
  const { getMarineData } = await import('../lib/jeju/marine')
  return getMarineData(spot || null)
}

function summarize(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    console.log('Unexpected payload:', payload)
    return
  }
  const p = payload as Record<string, unknown>
  console.log('\n── summary ──')
  console.log('ok         :', p.ok)
  console.log('spot/beach :', p.spot, '/', p.beachNum)
  console.log('tide       :', p.tide == null ? 'null' : JSON.stringify(p.tide).slice(0, 120))
  console.log('wave       :', p.wave == null ? 'null' : p.wave)
  console.log('waterTempC :', p.waterTempC)
  console.log('sun        :', p.sun)
  console.log(
    'warnings   :',
    Array.isArray(p.warnings) ? `${(p.warnings as unknown[]).length} item(s)` : p.warnings,
  )
  console.log('errors     :', p.errors)
  console.log('updatedAt  :', p.updatedAt)
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
