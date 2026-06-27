/**
 * Throwaway probe — KPX Jeju power (5분 수급) + SMP/demand endpoints.
 * Reports raw HTTP status / timing so we can tell "dead" vs "500" vs "slow".
 * Run:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/probe-kpx.ts
 */
const FETCH_TIMEOUT_MS = 30_000

type ErrWithCause = Error & { cause?: unknown }
function fmtErr(e: unknown): string {
  if (!(e instanceof Error)) return `non-Error: ${String(e)}`
  const err = e as ErrWithCause
  const parts = [`name=${err.name}`, `message=${err.message}`]
  if (err.cause !== undefined)
    parts.push(`cause=${err.cause instanceof Error ? `${err.cause.name}: ${err.cause.message}` : String(err.cause)}`)
  if (err.name === 'AbortError') parts.unshift(`TIMEOUT after ${FETCH_TIMEOUT_MS}ms`)
  return parts.join(' | ')
}

function kstYmd(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

async function probe(label: string, url: string): Promise<void> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  const started = Date.now()
  console.log(`\n--- ${label} ---`)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIMANI-Extractor/1.0)',
        Accept: 'application/json,text/json,*/*;q=0.8',
      },
    })
    const elapsed = Date.now() - started
    console.log(`HTTP ${res.status} ${res.statusText} | ${elapsed}ms`)
    const text = await res.text()
    console.log(`Body length: ${text.length} chars`)
    console.log(`Body head: ${text.slice(0, 240).replace(/\s+/g, ' ')}`)
  } catch (e) {
    const elapsed = Date.now() - started
    console.log(`ERROR after ${elapsed}ms: ${fmtErr(e)}`)
  } finally {
    clearTimeout(t)
  }
}

async function main(): Promise<void> {
  const kpxKey = process.env.KPX_SERVICE_KEY ?? ''
  const dataKey = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
  console.log(`KPX_SERVICE_KEY: ${kpxKey ? `${kpxKey.slice(0, 8)}…(${kpxKey.length})` : 'MISSING'}`)
  console.log(`DATA_GO_KR_KEY:  ${dataKey ? `${dataKey.slice(0, 8)}…(${dataKey.length})` : 'MISSING'}`)
  console.log(`timeout: ${FETCH_TIMEOUT_MS}ms`)

  const powerUrl = `https://openapi.kpx.or.kr/openapi/chejusukub5mToday/getChejuSukub5mToday?serviceKey=${encodeURIComponent(kpxKey)}`

  const smpParams = new URLSearchParams({
    serviceKey: dataKey,
    pageNo: '1',
    numOfRows: '48',
    dataType: 'JSON',
    date: kstYmd(),
  })
  const smpUrl = `https://apis.data.go.kr/B552115/SmpWithForecastDemand/getSmpWithForecastDemand?${smpParams.toString()}`

  // Probe each twice to gauge whether failures are transient.
  await probe('kpx-jeju-power (attempt 1)', powerUrl)
  await probe('kpx-jeju-power (attempt 2)', powerUrl)
  await probe('kpx-jeju-smp (attempt 1)', smpUrl)
  await probe('kpx-jeju-smp (attempt 2)', smpUrl)
}

main().catch((e) => {
  console.error(fmtErr(e))
  process.exit(1)
})
export {}
