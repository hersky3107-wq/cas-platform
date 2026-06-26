/**
 * Throwaway probe — odcloud Jeju tourist stats APIs (외국인·내국인 관광객).
 *
 * PURPOSE: inspect field names and response shape BEFORE writing connectors.
 *
 * Run:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/probe-tourist.ts
 */

const ENDPOINT_FOREIGN =
  'https://api.odcloud.kr/api/15061970/v1/uddi:a9a0b107-db41-4adc-a489-dcba0e474986'
const ENDPOINT_DOMESTIC =
  'https://api.odcloud.kr/api/3083546/v1/uddi:7ef5b5b5-e00d-490f-8624-bb2d543d0904'
const FETCH_TIMEOUT_MS = 35_000
const ROW_PREVIEW = 12

function sep(char = '─') {
  return char.repeat(70)
}

function redactKey(url: string): string {
  return url.replace(/([?&](?:serviceKey|ServiceKey)=)[^&]*/gi, '$1[REDACTED]')
}

type ErrorWithCause = Error & { cause?: unknown }

function formatFetchError(e: unknown): string {
  if (!(e instanceof Error)) {
    return `FETCH ERROR (non-Error): ${String(e)}`
  }
  const err = e as ErrorWithCause
  const parts = [`name=${err.name}`, `message=${err.message}`]
  if (err.cause !== undefined) {
    parts.push(
      `cause=${err.cause instanceof Error ? `${err.cause.name}: ${err.cause.message}` : String(err.cause)}`
    )
  }
  if (err.name === 'AbortError') {
    parts.unshift(`TIMEOUT after ${FETCH_TIMEOUT_MS}ms`)
  }
  return parts.join(' | ')
}

type OdcloudResponse = {
  currentCount?: unknown
  matchCount?: unknown
  page?: unknown
  perPage?: unknown
  totalCount?: unknown
  data?: unknown
}

async function runProbe(
  label: string,
  endpoint: string,
  perPage: string
): Promise<{ ok: boolean; status: number }> {
  const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
  const url = `${endpoint}?${new URLSearchParams({
    page: '1',
    perPage,
    serviceKey: key,
  }).toString()}`

  console.log(`\n${sep('═')}`)
  console.log(label)
  console.log(`REQUEST: ${redactKey(url)}`)
  console.log(sep())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let status = 0
  let body = ''
  let fetchError = ''

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Jeju-Probe/1.0)',
        Accept: 'application/json,*/*;q=0.8',
      },
    })
    status = res.status
    body = await res.text()
  } catch (e: unknown) {
    fetchError = formatFetchError(e)
  } finally {
    clearTimeout(timer)
  }

  if (fetchError) {
    console.log(`HTTP STATUS: ${fetchError}`)
    return { ok: false, status: 0 }
  }

  console.log(`HTTP STATUS: ${status}`)

  let parsed: OdcloudResponse | null = null
  try {
    parsed = JSON.parse(body) as OdcloudResponse
  } catch (e: unknown) {
    console.log(`JSON PARSE ERROR: ${formatFetchError(e)}`)
    console.log(`RAW BODY (first 1500 chars):\n${body.slice(0, 1500)}`)
    return { ok: false, status }
  }

  console.log(`totalCount: ${parsed.totalCount ?? '(missing)'}`)
  console.log(
    `envelope: currentCount=${parsed.currentCount ?? '?'} matchCount=${parsed.matchCount ?? '?'} page=${parsed.page ?? '?'} perPage=${parsed.perPage ?? '?'}`
  )

  const data = Array.isArray(parsed.data) ? (parsed.data as Record<string, unknown>[]) : []
  console.log(`data[] length: ${data.length}`)

  if (data.length === 0) {
    console.log('data[]: (empty)')
    return { ok: status >= 200 && status < 300, status }
  }

  console.log(`data[0] keys: ${Object.keys(data[0]!).join(', ')}`)

  const previewRows = data.slice(0, ROW_PREVIEW)
  console.log(`\nFULL data[] preview (first ${previewRows.length} of ${data.length} rows):`)
  console.log(JSON.stringify(previewRows, null, 2))

  if (data.length > ROW_PREVIEW) {
    console.log(`\n... [${data.length - ROW_PREVIEW} more rows not shown]`)
    console.log('\nFULL data[] (all rows):')
    console.log(JSON.stringify(data, null, 2))
  }

  return { ok: status >= 200 && status < 300 && data.length > 0, status }
}

async function main(): Promise<void> {
  const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
  if (!key) {
    console.error('ERROR: DATA_GO_KR_KEY / KPX_SERVICE_KEY is not set in env.')
    process.exit(1)
  }

  console.log(sep('═'))
  console.log('Jeju tourist stats probe — odcloud (외국인·내국인)')
  console.log(`Key (first 8 chars): ${key.slice(0, 8)}...`)
  console.log(`FETCH_TIMEOUT_MS: ${FETCH_TIMEOUT_MS}`)
  console.log(sep('═'))

  const start = Date.now()

  try {
    const rA = await runProbe(
      'CALL A — Foreign tourists (latest 2025, perPage=20)',
      ENDPOINT_FOREIGN,
      '20'
    )

    const rB = await runProbe(
      'CALL B — Domestic tourists (latest 2025, perPage=20)',
      ENDPOINT_DOMESTIC,
      '20'
    )

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`\n${sep('═')}`)
    console.log(`SUMMARY (${elapsed}s)`)
    console.log(sep())
    console.log(`Call A (foreign): HTTP ${rA.status}, ok=${rA.ok}`)
    console.log(`Call B (domestic): HTTP ${rB.status}, ok=${rB.ok}`)
  } catch (err: unknown) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.error(`\nFATAL (uncaught) after ${elapsed}s:`, formatFetchError(err))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Uncaught error:', formatFetchError(err))
  process.exit(1)
})

export {}
