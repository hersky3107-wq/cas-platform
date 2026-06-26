/**
 * Throwaway probe — odcloud cargo throughput API (화물물동량).
 * Run:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/probe-cargo.ts
 */
const ENDPOINT =
  'https://api.odcloud.kr/api/15056447/v1/uddi:1d9ca1d7-0576-4145-9567-fd4038aa3648'
const FETCH_TIMEOUT_MS = 35_000

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

async function fetchJson(url: string, extraHeaders: Record<string, string> = {}): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...extraHeaders },
    })
    console.log(`HTTP ${res.status}`)
    const text = await res.text()
    console.log(`Body length: ${text.length} chars`)
    return JSON.parse(text) as unknown
  } catch (e) {
    console.log(`ERROR: ${fmtErr(e)}`)
    return null
  } finally {
    clearTimeout(t)
  }
}

async function main(): Promise<void> {
  const key = process.env.KPX_SERVICE_KEY ?? ''
  console.log(`Key: ${key.slice(0, 8)}... | timeout: ${FETCH_TIMEOUT_MS}ms`)

  // Small page first — just enough to see field names
  const url3 = `${ENDPOINT}?${new URLSearchParams({ page: '1', perPage: '3', serviceKey: key })}`
  console.log('\n--- Call: page=1 perPage=3 (field names) ---')
  console.log(`URL: ${url3.replace(key, '[REDACTED]')}`)
  const j3 = await fetchJson(url3) as Record<string, unknown> | null
  if (j3) {
    console.log('totalCount:', j3.totalCount)
    const data = Array.isArray(j3.data) ? j3.data as Record<string, unknown>[] : []
    console.log(`data length: ${data.length}`)
    if (data[0]) {
      console.log('data[0] keys:', Object.keys(data[0]).join(', '))
      console.log('data[0]:', JSON.stringify(data[0], null, 2))
    }
    if (data[1]) console.log('data[1]:', JSON.stringify(data[1], null, 2))
    if (data[2]) console.log('data[2]:', JSON.stringify(data[2], null, 2))
  }
}

main().catch((e) => { console.error(fmtErr(e)); process.exit(1) })
export {}
