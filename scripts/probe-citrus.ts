/**
 * Throwaway probe — odcloud API for Jeju citrus production (품종별감귤생산현황).
 *
 * PURPOSE: discover (a) which auth method works (query serviceKey vs Authorization
 * header), (b) actual field names in data[], (c) whether 2023 data is present —
 * BEFORE writing a lib/jeju/connectors.ts adapter.
 *
 * Run:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/probe-citrus.ts
 */

const ENDPOINT =
  'https://api.odcloud.kr/api/15010584/v1/uddi:eba2a3ef-a809-4516-854b-94a342fd2af1'
const FETCH_TIMEOUT_MS = 35_000
const BODY_PREVIEW = 1_500

function sep(char = '─') {
  return char.repeat(70)
}

function redactKey(url: string): string {
  return url.replace(/([?&](?:serviceKey|ServiceKey)=)[^&]*/gi, '$1[REDACTED]')
}

function previewBody(text: string): string {
  const t = text.trim()
  if (t.length <= BODY_PREVIEW) return t
  return `${t.slice(0, BODY_PREVIEW)}\n... [${t.length - BODY_PREVIEW} more chars]`
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

type OdcloudShape = {
  currentCount: number | null
  matchCount: number | null
  page: number | null
  perPage: number | null
  totalCount: number | null
  fieldNames: string[]
  years: string[]
  has2023: boolean
  sampleRow: Record<string, unknown> | null
}

function parseOdcloudJson(raw: string): OdcloudShape | { parseError: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (e: unknown) {
    return { parseError: formatFetchError(e) }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { parseError: 'Response is not a JSON object' }
  }

  const root = parsed as Record<string, unknown>
  const dataRaw = root.data
  const rows: Record<string, unknown>[] = Array.isArray(dataRaw)
    ? (dataRaw as Record<string, unknown>[])
    : []

  const fieldNames =
    rows.length > 0 ? Object.keys(rows[0]!) : []

  const yearKeys = fieldNames.filter((k) => /연도|년|year/i.test(k))
  const years = new Set<string>()
  for (const row of rows) {
    for (const key of yearKeys) {
      const v = row[key]
      if (v !== null && v !== undefined) years.add(String(v).trim())
    }
    // Also scan all string values for "2023" in case year is embedded elsewhere.
    for (const v of Object.values(row)) {
      if (typeof v === 'string' && /\b2023\b/.test(v)) years.add('2023')
      if (v === 2023 || v === '2023') years.add('2023')
    }
  }

  const num = (v: unknown): number | null =>
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : null

  return {
    currentCount: num(root.currentCount),
    matchCount: num(root.matchCount),
    page: num(root.page),
    perPage: num(root.perPage),
    totalCount: num(root.totalCount),
    fieldNames,
    years: Array.from(years).sort(),
    has2023: years.has('2023'),
    sampleRow: rows[0] ?? null,
  }
}

async function runProbe(
  label: string,
  url: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; status: number }> {
  console.log(`\n${sep('═')}`)
  console.log(label)
  console.log(`REQUEST: ${redactKey(url)}`)
  if (headers.Authorization) {
    console.log('HEADER: Authorization: Infuser [REDACTED]')
  }
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
        ...headers,
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
  console.log(`BODY (first ${BODY_PREVIEW} chars):`)
  console.log(previewBody(body))

  const parsed = parseOdcloudJson(body)
  if ('parseError' in parsed) {
    console.log(`\nJSON PARSE: ${parsed.parseError}`)
    return { ok: status >= 200 && status < 300, status }
  }

  console.log('\nODCLOUD ENVELOPE:')
  console.log(
    `  currentCount=${parsed.currentCount ?? '?'} matchCount=${parsed.matchCount ?? '?'} page=${parsed.page ?? '?'} perPage=${parsed.perPage ?? '?'} totalCount=${parsed.totalCount ?? '?'}`
  )
  console.log(`  data[] field names (${parsed.fieldNames.length}): ${parsed.fieldNames.join(', ') || '(none)'}`)
  console.log(`  years seen in sample: ${parsed.years.length ? parsed.years.join(', ') : '(none)'}`)
  console.log(`  2023 data present in sample: ${parsed.has2023 ? 'YES' : 'NO'}`)
  if (parsed.sampleRow) {
    console.log('  first row:')
    console.log(JSON.stringify(parsed.sampleRow, null, 2))
  }

  return { ok: status >= 200 && status < 300 && parsed.fieldNames.length > 0, status }
}

async function main(): Promise<void> {
  const key = process.env.KPX_SERVICE_KEY ?? ''
  if (!key) {
    console.error('ERROR: KPX_SERVICE_KEY is not set in env.')
    process.exit(1)
  }

  console.log(sep('═'))
  console.log('odcloud citrus probe — 품종별감귤생산현황_20241231')
  console.log(`Key (first 8 chars): ${key.slice(0, 8)}...`)
  console.log(`FETCH_TIMEOUT_MS: ${FETCH_TIMEOUT_MS}`)
  console.log(sep('═'))

  const start = Date.now()

  try {
    const urlA = `${ENDPOINT}?${new URLSearchParams({
      page: '1',
      perPage: '5',
      serviceKey: key,
    }).toString()}`

    const rA = await runProbe('CALL A — serviceKey as QUERY param', urlA, {})

    const urlB = `${ENDPOINT}?${new URLSearchParams({
      page: '1',
      perPage: '5',
    }).toString()}`

    const rB = await runProbe('CALL B — Authorization: Infuser <KEY> header', urlB, {
      Authorization: `Infuser ${key}`,
    })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`\n${sep('═')}`)
    console.log(`SUMMARY (${elapsed}s)`)
    console.log(sep())
    console.log(`Call A (query serviceKey): HTTP ${rA.status}, ok=${rA.ok}`)
    console.log(`Call B (Authorization header): HTTP ${rB.status}, ok=${rB.ok}`)
    if (rA.ok && !rB.ok) {
      console.log('→ Query param auth likely works; header auth failed or returned empty data.')
    } else if (!rA.ok && rB.ok) {
      console.log('→ Authorization header auth works; query param failed.')
    } else if (rA.ok && rB.ok) {
      console.log('→ Both auth methods returned usable JSON.')
    } else {
      console.log('→ Neither auth method returned usable JSON — check key or endpoint.')
    }
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
