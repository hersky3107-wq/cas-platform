/**
 * Jeju/national data-source verification script.
 * Run (PowerShell):
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/verify-jeju-apis.ts
 *
 * Reads env keys from .env.local — does NOT modify any file.
 * DO NOT GUESS endpoint URLs — paste confirmed URLs into CONFIG below.
 * Sources with no URL yet are marked NOT_CONFIGURED and skipped.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Verdict = 'LIVE' | 'EMPTY' | 'AUTH' | 'DEAD' | 'RATE' | 'TIMEOUT' | 'ERROR_OTHER' | 'NOT_CONFIGURED'

interface SourceConfig {
  /** Short identifier shown in the output table */
  id: string
  /** Full resolved URL string (or null = NOT_CONFIGURED) */
  url: string | null
  /** HTTP method (default GET) */
  method?: 'GET' | 'POST'
  /** Extra headers beyond the shared defaults */
  headers?: Record<string, string>
  /** POST body if needed */
  body?: string
  /** How to decide if the response has non-empty data rows.
   *  Receives the parsed body (unknown) and raw text.
   *  Return true = LIVE, false = EMPTY.
   *  Omit → default: any non-empty text = LIVE. */
  hasData?: (parsed: unknown, raw: string) => boolean
  /**
   * Optional fully-custom probe that replaces the generic `probe()` for this
   * source (e.g. when retry logic or bespoke parsing is required).
   * If provided, `url` / `method` / `body` / `hasData` are ignored.
   */
  customProbe?: () => Promise<Row>
}

interface Row {
  source: string
  httpStatus: string
  verdict: Verdict
  note: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 12_000

function kstYmd(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function kstYm(): string {
  return kstYmd().slice(0, 6)
}

/** Detect common Korean public-API auth/error codes embedded in a 200 response. */
function detectAuthCode(raw: string): string | null {
  // XML: <resultCode>...</resultCode> or <returnReasonCode>...</returnReasonCode>
  const xmlCode = raw.match(/<(?:resultCode|returnReasonCode|errMsg)>\s*([^<]+)\s*</)?.[1]?.trim()
  if (xmlCode && xmlCode !== '00' && xmlCode !== '0000' && xmlCode !== 'OK') return xmlCode
  // JSON: "resultCode": "..." or "RESULT_CODE": "..."
  const jsonMatch = raw.match(/"(?:resultCode|RESULT_CODE|errorCode|error_code)"\s*:\s*"([^"]+)"/)
  if (jsonMatch?.[1]) {
    const code = jsonMatch[1].trim()
    if (code !== '00' && code !== '0000' && code !== 'OK' && code !== 'SUCCESS') return code
  }
  return null
}

/** Auth-error keywords that appear in bodies of 200-with-auth-error responses. */
const AUTH_KEYWORDS = [
  'SERVICE_KEY_IS_NOT_REGISTERED',
  'RESTRICTED_ACCESS',
  'INVALID_REQUEST_PARAMETER',
  'LIMITED_NUMBER',
  'SERVICE_ACCESS_DENIED',
  'SERVICEKEYEXPIRED',
  'NOT_REGISTERED_SERVICEKEY',
  'AuthenticationFailed',
  '인증키',
  '서비스키',
  '인증 실패',
]

function bodyLooksLikeAuth(raw: string): boolean {
  const up = raw.toUpperCase()
  return AUTH_KEYWORDS.some((k) => up.includes(k.toUpperCase()))
}

async function probe(cfg: SourceConfig): Promise<Row> {
  if (cfg.url === null) {
    return { source: cfg.id, httpStatus: '—', verdict: 'NOT_CONFIGURED', note: 'URL not filled in' }
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  const started = Date.now()
  let httpStatus = '—'
  let raw = ''

  try {
    const res = await fetch(cfg.url, {
      method: cfg.method ?? 'GET',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIMANI-Verifier/1.0)',
        Accept: 'application/json,application/xml,text/xml,*/*;q=0.8',
        ...(cfg.headers ?? {}),
      },
      ...(cfg.body ? { body: cfg.body } : {}),
    })
    httpStatus = String(res.status)

    try { raw = await res.text() } catch { raw = '' }

    if (res.status === 429) return { source: cfg.id, httpStatus, verdict: 'RATE', note: raw.slice(0, 120) }
    if (res.status === 401 || res.status === 403) return { source: cfg.id, httpStatus, verdict: 'AUTH', note: raw.slice(0, 120) }
    if (res.status === 404 || res.status === 410) return { source: cfg.id, httpStatus, verdict: 'DEAD', note: `HTTP ${res.status}` }
    if (!res.ok) return { source: cfg.id, httpStatus, verdict: 'ERROR_OTHER', note: raw.slice(0, 200) }

    // HTTP 200 — check for embedded error codes
    const embeddedCode = detectAuthCode(raw)
    if (embeddedCode) {
      const kind = bodyLooksLikeAuth(raw) || embeddedCode.includes('AUTH') || embeddedCode.includes('KEY')
        ? 'AUTH' : 'ERROR_OTHER'
      return { source: cfg.id, httpStatus, verdict: kind, note: `embedded code: ${embeddedCode} | ${raw.slice(0, 120)}` }
    }
    if (bodyLooksLikeAuth(raw)) {
      return { source: cfg.id, httpStatus, verdict: 'AUTH', note: raw.slice(0, 120) }
    }

    // Check data presence
    const empty = raw.trim() === ''
    if (empty) return { source: cfg.id, httpStatus, verdict: 'EMPTY', note: 'empty body' }

    let parsed: unknown = null
    try { parsed = JSON.parse(raw) } catch { /* XML or non-JSON */ }

    const hasData = cfg.hasData
      ? cfg.hasData(parsed, raw)
      : raw.trim().length > 0

    const elapsed = Date.now() - started
    return {
      source: cfg.id,
      httpStatus,
      verdict: hasData ? 'LIVE' : 'EMPTY',
      note: `${raw.length} bytes, ${elapsed}ms`,
    }
  } catch (e: unknown) {
    const elapsed = Date.now() - started
    const aborted = e instanceof Error && e.name === 'AbortError'
    if (aborted) return { source: cfg.id, httpStatus, verdict: 'TIMEOUT', note: `>${elapsed}ms` }
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    const verdict: Verdict = msg.toLowerCase().includes('enotfound') || msg.toLowerCase().includes('econnrefused')
      ? 'DEAD'
      : 'ERROR_OTHER'
    return { source: cfg.id, httpStatus, verdict, note: msg.slice(0, 200) }
  } finally {
    clearTimeout(t)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — paste confirmed URLs here. Leave url:null for anything not yet known.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
const KAMIS_KEY = process.env.KAMIS_CERT_KEY ?? ''
const KAMIS_ID = process.env.KAMIS_CERT_ID ?? ''

// Ignore unused-var warnings for env keys that have TODO sources
void KAMIS_KEY
void KAMIS_ID

const CONFIG: SourceConfig[] = [

  // ── visitjeju.net — 관광 명소 ──────────────────────────────────────────────
  // Endpoint: http://api.visitjeju.net/vsjApi/contents/searchList
  // Param-name inconsistency: spec table uses "apikey" (lowercase), example URL
  // uses "apiKey" (capital K). Try "apiKey" first; retry with "apikey" on auth
  // failure. Note which variant worked in the output.
  {
    id: 'visitjeju-attractions',
    url: null, // drives NOT_CONFIGURED fallback if customProbe is absent — overridden below
    customProbe: async (): Promise<Row> => {
      const visitKey = process.env.VISITJEJU_API_KEY ?? ''
      if (!visitKey) {
        return {
          source: 'visitjeju-attractions',
          httpStatus: '—',
          verdict: 'NOT_CONFIGURED',
          note: 'VISITJEJU_API_KEY not set in .env.local',
        }
      }

      const BASE = 'https://api.visitjeju.net/vsjApi/contents/searchList'

      /** One attempt; returns the Row if conclusive, or null to retry. */
      async function attempt(paramName: 'apiKey' | 'apikey'): Promise<Row | null> {
        const params = new URLSearchParams({ [paramName]: visitKey, locale: 'kr', page: '1' })
        const url = `${BASE}?${params.toString()}`
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
        const started = Date.now()
        let httpStatus = '—'
        let raw = ''
        try {
          const res = await fetch(url, {
            method: 'GET',
            signal: ctrl.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; AIMANI-Verifier/1.0)',
              Accept: 'application/json,*/*;q=0.8',
            },
          })
          httpStatus = String(res.status)
          try { raw = await res.text() } catch { raw = '' }

          if (res.status === 429) {
            return { source: 'visitjeju-attractions', httpStatus, verdict: 'RATE', note: raw.slice(0, 120) }
          }
          if (res.status === 401 || res.status === 403) {
            return null // auth → retry with the other param name
          }
          if (res.status === 404 || res.status === 410) {
            return { source: 'visitjeju-attractions', httpStatus, verdict: 'DEAD', note: `HTTP ${res.status}` }
          }
          if (!res.ok) {
            return { source: 'visitjeju-attractions', httpStatus, verdict: 'ERROR_OTHER', note: raw.slice(0, 200) }
          }

          // HTTP 200 — parse JSON regardless of resultCode (spec inconsistency)
          if (bodyLooksLikeAuth(raw)) {
            return null // auth in body → retry with other param name
          }

          let parsed: unknown = null
          try { parsed = JSON.parse(raw) } catch { /* not JSON */ }

          if (parsed && typeof parsed === 'object') {
            const o = parsed as Record<string, unknown>
            // Flat response: { result, resultMessage, totalCount, items: [...] }
            const totalCount = Number(o.totalCount ?? 0)
            const items = Array.isArray(o.items) ? o.items as Record<string, unknown>[] : []
            const elapsed = Date.now() - started
            if (totalCount > 0 && items.length > 0) {
              const firstTitle = (items[0]?.title as string | undefined) ?? '(제목 없음)'
              return {
                source: 'visitjeju-attractions',
                httpStatus,
                verdict: 'LIVE',
                note: `param=${paramName} totalCount=${totalCount} items[0]="${firstTitle}" ${elapsed}ms`,
              }
            }
            return {
              source: 'visitjeju-attractions',
              httpStatus,
              verdict: 'EMPTY',
              note: `param=${paramName} totalCount=${totalCount} items=${items.length} ${elapsed}ms`,
            }
          }

          // Couldn't parse expected shape
          const elapsed = Date.now() - started
          return {
            source: 'visitjeju-attractions',
            httpStatus,
            verdict: raw.trim() ? 'ERROR_OTHER' : 'EMPTY',
            note: `param=${paramName} unexpected body shape: ${raw.slice(0, 160)} ${elapsed}ms`,
          }
        } catch (e: unknown) {
          const elapsed = Date.now() - started
          if (e instanceof Error && e.name === 'AbortError') {
            return { source: 'visitjeju-attractions', httpStatus, verdict: 'TIMEOUT', note: `param=${paramName} >${elapsed}ms` }
          }
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
          const isNetErr = msg.toLowerCase().includes('enotfound') || msg.toLowerCase().includes('econnrefused')
          return {
            source: 'visitjeju-attractions',
            httpStatus,
            verdict: isNetErr ? 'DEAD' : 'ERROR_OTHER',
            note: `param=${paramName} ${msg.slice(0, 180)}`,
          }
        } finally {
          clearTimeout(t)
        }
      }

      // Try "apiKey" (capital K) first per the example URL
      const r1 = await attempt('apiKey')
      if (r1 !== null) return r1
      // Auth-style failure — retry with lowercase "apikey"
      const r2 = await attempt('apikey')
      if (r2 !== null) return r2
      // Both failed with auth
      return {
        source: 'visitjeju-attractions',
        httpStatus: '—',
        verdict: 'AUTH',
        note: 'both apiKey and apikey returned auth failure',
      }
    },
  },

  // ── 환율 — exchange rate ──────────────────────────────────────────────────
  // TODO: paste confirmed endpoint (e.g. 한국은행 기준금리API, 금융결제원, or Korea Eximbank)
  {
    id: 'exchange-rate',
    url: null, // TODO
  },

  // ── 유가 — domestic oil price (Opinet, 한국석유공사) ─────────────────────
  // TODO: paste confirmed Opinet API endpoint + apikey param
  {
    id: 'oil-price-domestic',
    url: null, // TODO: e.g. `https://www.opinet.co.kr/api/...?code=${process.env.OPINET_KEY}&out=json`
  },

  // ── 유가 — international oil price (Opinet) ───────────────────────────────
  // TODO
  {
    id: 'oil-price-intl',
    url: null, // TODO
  },

  // ── 제주공항 — airport traffic ───────────────────────────────────────────
  // TODO: paste confirmed endpoint (data.go.kr 항공통계 or 제주공항 전용 API)
  {
    id: 'jeju-airport',
    url: null, // TODO
  },

  // ── 국토부 실거래가 — MOLIT real transaction (아파트 매매) ─────────────────
  // TODO: paste confirmed endpoint + LAWD_CD / DEAL_YMD params
  {
    id: 'molit-realtransaction',
    url: null, // TODO: e.g. `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTrade?...`
    hasData: (p) => {
      if (!p || typeof p !== 'object') return false
      const items = ((p as Record<string, unknown>).response as Record<string, unknown>)
        ?.body as Record<string, unknown>
      return typeof items?.totalCount === 'string' && Number(items.totalCount) > 0
    },
  },

  // ── 나이스 학생 현황 — NEIS (교육통계서비스) ─────────────────────────────
  // TODO: paste confirmed NEIS Open API endpoint
  {
    id: 'neis-school',
    url: null, // TODO: e.g. `https://open.neis.go.kr/hub/...?KEY=${process.env.NEIS_KEY}&...`
  },

  // ── KOSIS — 통계청 오픈API ────────────────────────────────────────────────
  // TODO: paste confirmed KOSIS endpoint + table id
  {
    id: 'kosis',
    url: null, // TODO: e.g. `https://kosis.kr/openapi/...?apiKey=${process.env.KOSIS_KEY}&...`
  },

  // ── 폐기물 통계 — waste statistics ───────────────────────────────────────
  // TODO: paste confirmed endpoint (환경부 공공데이터 or data.go.kr)
  {
    id: 'waste-statistics',
    url: (() => {
      // data.go.kr dataset 15073461 — 전국 폐기물 발생 및 처리 현황
      // Params below are illustrative; replace with confirmed values.
      // TODO: confirm dataset id + param names
      const p = new URLSearchParams({
        serviceKey: KEY,
        pageNo: '1',
        numOfRows: '10',
        resultType: 'json',
        year: kstYm().slice(0, 4),
      })
      return `https://apis.data.go.kr/1480523/MonthlyWasteInfo/getMonthlyWasteInfo?${p.toString()}`
    })(),
    hasData: (p) => {
      if (!p || typeof p !== 'object') return false
      const items = ((p as Record<string, unknown>).response as Record<string, unknown>)
        ?.body as Record<string, unknown>
      return typeof items?.totalCount === 'string' && Number(items.totalCount) > 0
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

const VERDICT_EMOJI: Record<Verdict, string> = {
  LIVE: '✅',
  EMPTY: '🟡',
  AUTH: '🔑',
  DEAD: '💀',
  RATE: '⏱',
  TIMEOUT: '⏰',
  ERROR_OTHER: '❌',
  NOT_CONFIGURED: '⬜',
}

async function main(): Promise<void> {
  const today = kstYmd()
  console.log(`\nJeju API Verification — ${today} KST`)
  console.log(`Key prefix: ${KEY ? KEY.slice(0, 8) + '…' : 'MISSING'}\n`)

  const COL = { source: 28, http: 6, verdict: 16, note: 80 }
  const header = `| ${pad('source', COL.source)} | ${pad('http', COL.http)} | ${pad('verdict', COL.verdict)} | note`
  const sep = `|-${'-'.repeat(COL.source)}-|-${'-'.repeat(COL.http)}-|-${'-'.repeat(COL.verdict)}-|------`
  console.log(header)
  console.log(sep)

  const rows: Row[] = []
  for (const cfg of CONFIG) {
    process.stdout.write(`  probing ${cfg.id}…`)
    const row = await (cfg.customProbe ? cfg.customProbe() : probe(cfg))
    rows.push(row)
    const emoji = VERDICT_EMOJI[row.verdict]
    const line = `| ${pad(row.source, COL.source)} | ${pad(row.httpStatus, COL.http)} | ${pad(`${emoji} ${row.verdict}`, COL.verdict + 1)} | ${row.note.slice(0, COL.note)}`
    process.stdout.write('\r')
    console.log(line)
  }

  // Summary
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1
    return acc
  }, {})
  console.log()
  console.log('Summary:')
  for (const [v, n] of Object.entries(counts).sort()) {
    console.log(`  ${VERDICT_EMOJI[v as Verdict] ?? '?'} ${v}: ${n}`)
  }
  const notConfigured = rows.filter((r) => r.verdict === 'NOT_CONFIGURED').length
  if (notConfigured > 0) {
    console.log(`\n⚠️  ${notConfigured} source(s) need a URL in the CONFIG array (marked TODO).`)
  }
  console.log()
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})
export {}
