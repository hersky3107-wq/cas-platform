/**
 * Throwaway verify — calls GET /api/domin/weather-alert and prints today /
 * tomorrow / week / warnings / context (+ contextMeta).
 *
 * Prefers a running Next.js dev server (NEXT_BASE_URL, default
 * http://localhost:3000). Falls back to calling getWeatherAlert() directly
 * when the server is unreachable.
 *
 * Run (with `npm run dev` in another terminal):
 *   npx tsx --env-file=.env.local scripts/verify-weather-alert.ts
 *   npx tsx --env-file=.env.local scripts/verify-weather-alert.ts 서귀포
 *
 * Direct fallback (no Next server) needs the server-only stub:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/verify-weather-alert.ts
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const region = process.argv[2] ?? '제주시'

async function viaHttp(): Promise<unknown> {
  const params = new URLSearchParams({ region })
  const url = `${BASE}/api/domin/weather-alert?${params.toString()}`
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
  console.log('(dev server unreachable — calling getWeatherAlert() directly)')
  const { getWeatherAlert } = await import('../lib/jeju/weather-alert')
  return getWeatherAlert(region)
}

function summarize(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    console.log('Unexpected payload:', payload)
    return
  }
  const p = payload as Record<string, unknown>
  const today = p.today as Record<string, unknown> | null
  const tomorrow = p.tomorrow as Record<string, unknown> | null
  const week = Array.isArray(p.week) ? (p.week as Record<string, unknown>[]) : []
  const warnings = Array.isArray(p.warnings) ? (p.warnings as Record<string, unknown>[]) : []
  const meta = (p.contextMeta ?? {}) as Record<string, unknown>

  console.log('\n── summary ──')
  console.log('ok         :', p.ok)
  console.log('region     :', p.region)
  console.log('source     :', p.source, '/', p.confidence)
  console.log('today      :', today == null ? 'null' : JSON.stringify(today))
  console.log('tomorrow   :', tomorrow == null ? 'null' : JSON.stringify(tomorrow))
  console.log('week       :', `${week.length} day(s)`)
  for (const d of week) {
    console.log(
      `   • ${d.date}: ${d.amText ?? '?'}/${d.pmText ?? '?'}  ${d.tempMinC ?? '?'}~${d.tempMaxC ?? '?'}℃  강수 ${d.rainProbAm ?? '?'}%/${d.rainProbPm ?? '?'}%`,
    )
  }
  console.log('warnings   :', `${warnings.length} item(s)`)
  for (const w of warnings) {
    console.log(`   • ${w.type}${w.level} (${w.area}) @ ${w.issuedAt}`)
  }
  console.log('\n── context ──')
  console.log(p.context || '(empty)')
  console.log('\n── contextMeta ──')
  console.log('source      :', meta.source)
  console.log('retrievedAt :', meta.retrievedAt)
  console.log('asOf        :', meta.asOf ?? '(null)')
  console.log('\nerrors      :', p.errors)
  console.log('freshness   :', p.freshnessNote)
  console.log('updatedAt   :', p.updatedAt)
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
