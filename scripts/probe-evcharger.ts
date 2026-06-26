/**
 * Throwaway probe — data.go.kr EV charger capacity API (getYrMnChgcpcyInfo).
 *
 * PURPOSE: find a server-side request param that filters to Jeju (rgnNm) before
 * writing a lib/jeju/connectors.ts adapter. Nationwide totalCount ≈ 432977.
 *
 * Run:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/probe-evcharger.ts
 */

const ENDPOINT =
  'https://apis.data.go.kr/B552584/pbnstFstChrgrChgcpcyInfo/getYrMnChgcpcyInfo'
const FETCH_TIMEOUT_MS = 35_000
const JEJU_LABEL = '제주특별자치도'

const BASE_PARAMS = {
  pageNo: '1',
  numOfRows: '5',
  returnType: 'JSON',
} as const

function sep(char = '─') {
  return char.repeat(70)
}

function redactKey(url: string): string {
  return url.replace(/([?&](?:serviceKey|ServiceKey)=)[^&]*/gi, '$1[REDACTED]')
}

function buildUrl(params: Record<string, string>): string {
  const q = new URLSearchParams(params)
  return `${ENDPOINT}?${q.toString()}`
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

type ParsedProbe = {
  ok: boolean
  status: number
  resultCode: string
  resultMsg: string
  totalCount: number | null
  rgnNames: string[]
  rawJson: unknown
}

function parseResponse(rawJson: unknown): Omit<ParsedProbe, 'ok' | 'status'> {
  if (!rawJson || typeof rawJson !== 'object') {
    return {
      resultCode: '',
      resultMsg: 'Unexpected response shape',
      totalCount: null,
      rgnNames: [],
      rawJson,
    }
  }

  const root = rawJson as Record<string, unknown>
  // This API uses top-level { header, body }; others nest under response.
  const envelope =
    root.response && typeof root.response === 'object'
      ? (root.response as Record<string, unknown>)
      : root

  const header =
    envelope.header && typeof envelope.header === 'object'
      ? (envelope.header as Record<string, unknown>)
      : null
  const resultCodeRaw = header?.resultCode
  const resultCode =
    typeof resultCodeRaw === 'string' || typeof resultCodeRaw === 'number'
      ? String(resultCodeRaw)
      : ''
  const resultMsg = typeof header?.resultMsg === 'string' ? header.resultMsg : ''

  const body =
    envelope.body && typeof envelope.body === 'object'
      ? (envelope.body as Record<string, unknown>)
      : null
  const totalCountRaw = body?.totalCount
  const totalCount =
    typeof totalCountRaw === 'number'
      ? totalCountRaw
      : typeof totalCountRaw === 'string' && totalCountRaw.trim() !== ''
        ? Number(totalCountRaw)
        : null

  const itemsRaw = body?.items
  let items: Record<string, unknown>[] = []
  if (Array.isArray(itemsRaw)) {
    items = itemsRaw as Record<string, unknown>[]
  } else if (itemsRaw && typeof itemsRaw === 'object') {
    const container = itemsRaw as Record<string, unknown>
    const itemRaw = container.item
    items = Array.isArray(itemRaw)
      ? (itemRaw as Record<string, unknown>[])
      : itemRaw && typeof itemRaw === 'object'
        ? [itemRaw as Record<string, unknown>]
        : []
  }

  const rgnNames = items.map((it) => String(it.rgnNm ?? '(missing rgnNm)'))

  return { resultCode, resultMsg, totalCount, rgnNames, rawJson }
}

function isJejuFilter(totalCount: number | null, rgnNames: string[]): boolean {
  if (totalCount === null || rgnNames.length === 0) return false
  if (totalCount >= 100_000) return false
  return rgnNames.every((name) => name.includes('제주'))
}

async function runProbe(
  label: string,
  params: Record<string, string>
): Promise<ParsedProbe> {
  const url = buildUrl(params)
  console.log(`\n${sep('═')}`)
  console.log(label)
  console.log(`REQUEST: ${redactKey(url)}`)
  console.log(sep())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let status = 0
  let rawJson: unknown = null
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
    const text = await res.text()
    try {
      rawJson = JSON.parse(text) as unknown
    } catch {
      rawJson = { _parseError: true, _rawPreview: text.slice(0, 500) }
    }
  } catch (e: unknown) {
    fetchError = formatFetchError(e)
  } finally {
    clearTimeout(timer)
  }

  if (fetchError) {
    console.log(`HTTP STATUS: ${fetchError}`)
    return {
      ok: false,
      status: 0,
      resultCode: '',
      resultMsg: fetchError,
      totalCount: null,
      rgnNames: [],
      rawJson: null,
    }
  }

  const parsed = parseResponse(rawJson)
  console.log(`HTTP STATUS: ${status}`)
  console.log(`resultCode: ${parsed.resultCode || '(none)'} | resultMsg: ${parsed.resultMsg || '(none)'}`)
  console.log(`totalCount: ${parsed.totalCount ?? '(missing)'}`)
  console.log(`items returned: ${parsed.rgnNames.length}`)
  parsed.rgnNames.forEach((name, i) => {
    console.log(`  [${i + 1}] rgnNm: ${name}`)
  })
  console.log('\nPARSED JSON (full):')
  console.log(JSON.stringify(rawJson, null, 2))

  return {
    ok: status >= 200 && status < 300 && (parsed.resultCode === '00' || parsed.resultCode === '200'),
    status,
    ...parsed,
  }
}

async function main(): Promise<void> {
  const key = process.env.KPX_SERVICE_KEY ?? ''
  if (!key) {
    console.error('ERROR: KPX_SERVICE_KEY is not set in env.')
    process.exit(1)
  }

  console.log(sep('═'))
  console.log('EV charger capacity probe — getYrMnChgcpcyInfo')
  console.log(`Key (first 8 chars): ${key.slice(0, 8)}...`)
  console.log(`FETCH_TIMEOUT_MS: ${FETCH_TIMEOUT_MS}`)
  console.log(`Nationwide baseline totalCount expected ≈ 432977; Jeju filter should drop sharply.`)
  console.log(sep('═'))

  const common = { serviceKey: key, ...BASE_PARAMS }
  const start = Date.now()

  const results: { label: string; param: string | null; result: ParsedProbe }[] = []

  try {
    const rA = await runProbe('CALL A — baseline (no region filter)', { ...common })
    results.push({ label: 'A', param: null, result: rA })

    const rB = await runProbe(`CALL B — sidoNm=${JEJU_LABEL}`, {
      ...common,
      sidoNm: JEJU_LABEL,
    })
    results.push({ label: 'B', param: 'sidoNm', result: rB })

    const rC = await runProbe(`CALL C — rgnNm=${JEJU_LABEL}`, {
      ...common,
      rgnNm: JEJU_LABEL,
    })
    results.push({ label: 'C', param: 'rgnNm', result: rC })

    const rD = await runProbe(`CALL D — ctprvnNm=${JEJU_LABEL}`, {
      ...common,
      ctprvnNm: JEJU_LABEL,
    })
    results.push({ label: 'D', param: 'ctprvnNm', result: rD })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`\n${sep('═')}`)
    console.log(`SUMMARY (${elapsed}s)`)
    console.log(sep())

    const baselineCount = rA.totalCount
    for (const { label, param, result } of results) {
      const filterHint =
        label === 'A'
          ? 'baseline'
          : isJejuFilter(result.totalCount, result.rgnNames)
            ? 'LIKELY JEJU FILTER ✓'
            : 'no Jeju filter detected'
      console.log(
        `Call ${label}${param ? ` (${param})` : ''}: HTTP ${result.status}, totalCount=${result.totalCount ?? '?'}, rgnNm=[${result.rgnNames.join(', ')}] — ${filterHint}`
      )
    }

    const winners = results.filter(
      (r) => r.param !== null && isJejuFilter(r.result.totalCount, r.result.rgnNames)
    )
    if (winners.length > 0) {
      console.log(
        `\nJeju filter candidate(s): ${winners.map((w) => `${w.param} (Call ${w.label}, totalCount=${w.result.totalCount})`).join(', ')}`
      )
    } else {
      console.log(
        `\nNo server-side Jeju filter found among sidoNm / rgnNm / ctprvnNm.` +
          (baselineCount != null ? ` Baseline totalCount=${baselineCount}.` : '') +
          ' Will need client-side paging + rgnNm filter.'
      )
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
