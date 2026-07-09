/**
 * Throwaway verify — calls GET /api/domin/transport and prints bus / airport /
 * ferry / context (+ contextMeta), confirming the TAGO bus reuse, the CJU
 * airport route filter, and the Jeju ferry-port resolution.
 *
 * Prefers a running Next.js dev server (NEXT_BASE_URL, default
 * http://localhost:3000). Falls back to calling getTransport() directly when
 * the server is unreachable.
 *
 * Run (with `npm run dev` in another terminal):
 *   npx tsx --env-file=.env.local scripts/verify-transport.ts
 *   npx tsx --env-file=.env.local scripts/verify-transport.ts departure
 *
 * Direct fallback (no Next server) needs the server-only stub:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/verify-transport.ts
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const type = process.argv[2] ?? 'both'

async function viaHttp(): Promise<unknown> {
  const params = new URLSearchParams({ type })
  const url = `${BASE}/api/domin/transport?${params.toString()}`
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
  console.log('(dev server unreachable — calling getTransport() directly)')
  const { getTransport } = await import('../lib/jeju/transport')
  return getTransport({ type: type as 'departure' | 'arrival' | 'both' })
}

function summarize(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    console.log('Unexpected payload:', payload)
    return
  }
  const p = payload as Record<string, unknown>
  const bus = Array.isArray(p.bus) ? (p.bus as Record<string, unknown>[]) : []
  const airport = (p.airport ?? {}) as Record<string, unknown>
  const departures = Array.isArray(airport.departures) ? (airport.departures as Record<string, unknown>[]) : []
  const arrivals = Array.isArray(airport.arrivals) ? (airport.arrivals as Record<string, unknown>[]) : []
  const ferry = Array.isArray(p.ferry) ? (p.ferry as Record<string, unknown>[]) : []
  const meta = (p.contextMeta ?? {}) as Record<string, unknown>

  console.log('\n── summary ──')
  console.log('ok         :', p.ok)
  console.log('source     :', p.source, '/', p.confidence)

  console.log('\nbus        :', `${bus.length} row(s)`)
  for (const b of bus.slice(0, 10)) {
    console.log(`   • ${b.route}번  ${b.arrivalMin}분 후  (${b.stopsLeft}정류장 전)  @ ${b.stopName}${b.lowFloor ? '  [저상]' : ''}`)
  }

  console.log('\nairport    :', `출발 ${departures.length} / 도착 ${arrivals.length}`)
  for (const f of departures.slice(0, 8)) {
    console.log(`   ↗ ${f.schedTime ?? '?'}  ${f.flightId}  ${f.airline ?? ''}  ${f.origin}→${f.dest}  [${f.status}]`)
  }
  for (const f of arrivals.slice(0, 8)) {
    console.log(`   ↘ ${f.schedTime ?? '?'}  ${f.flightId}  ${f.airline ?? ''}  ${f.origin}→${f.dest}  [${f.status}]`)
  }

  console.log('\nferry      :', `${ferry.length} sailing(s)`)
  for (const f of ferry.slice(0, 12)) {
    console.log(`   ⛴ ${f.schedTime ?? '?'}  ${f.route}  [${f.status}]`)
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
