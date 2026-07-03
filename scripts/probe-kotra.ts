/**
 * Diagnostic probe — KOTRA 국가정보 + 상품DB raw responses.
 *
 * Shows the FULL request URL (serviceKey masked to last 4 chars), the HTTP
 * status, Content-Type, and the first 800 chars of the raw body VERBATIM —
 * before any extraction logic. This tells us the actual failure mode.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/probe-kotra.ts
 */

const TIMEOUT_MS = 15_000
const BODY_PREVIEW = 800

/** Mask everything except the last 4 chars of the service key. */
function maskKey(url: string): string {
  return url.replace(/(serviceKey=)([^&]+)/i, (_, prefix, key: string) => {
    const tail = key.slice(-4)
    return `${prefix}${'*'.repeat(Math.max(0, key.length - 4))}${tail}`
  })
}

async function probeRaw(label: string, url: string): Promise<void> {
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`PROBE: ${label}`)
  console.log(`URL  : ${maskKey(url)}`)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  let status = 0
  let contentType = '(no response)'
  let bodySnippet = '(no body)'

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIMANI-Probe/1.0)',
        Accept: 'application/json,text/xml,*/*;q=0.8',
      },
    })
    status = res.status
    contentType = res.headers.get('content-type') ?? '(none)'

    const raw = await res.text()
    bodySnippet =
      raw.length > BODY_PREVIEW
        ? `${raw.slice(0, BODY_PREVIEW)} … [total ${raw.length} chars]`
        : raw || '(empty body)'
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    bodySnippet = aborted
      ? `TIMEOUT after ${TIMEOUT_MS}ms`
      : `NETWORK ERROR: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    clearTimeout(timer)
  }

  console.log(`STATUS: ${status}`)
  console.log(`CONTENT-TYPE: ${contentType}`)
  console.log(`BODY (first ${BODY_PREVIEW} chars):\n${bodySnippet}`)
}

async function main() {
  // ── Key diagnostics ────────────────────────────────────────────────────────
  const dataGoKrKey = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
  const koreaeximKey = process.env.KOREAEXIM_API_KEY ?? ''

  console.log(`\n${'═'.repeat(70)}`)
  console.log('KOTRA / KoreaExim probe — AX COUNCIL data connector diagnostics')
  console.log(`${'═'.repeat(70)}`)
  console.log(`\nENV VARS:`)
  console.log(`  DATA_GO_KR_KEY    : ${process.env.DATA_GO_KR_KEY ? `SET (length ${process.env.DATA_GO_KR_KEY.length}, last4 …${process.env.DATA_GO_KR_KEY.slice(-4)})` : 'NOT SET'}`)
  console.log(`  KPX_SERVICE_KEY   : ${process.env.KPX_SERVICE_KEY ? `SET (length ${process.env.KPX_SERVICE_KEY.length}, last4 …${process.env.KPX_SERVICE_KEY.slice(-4)})` : 'NOT SET'}`)
  console.log(`  KOREAEXIM_API_KEY : ${koreaeximKey ? `SET (length ${koreaeximKey.length}, last4 …${koreaeximKey.slice(-4)})` : 'NOT SET'}`)
  console.log(`  → KOTRA calls use: ${process.env.DATA_GO_KR_KEY ? 'DATA_GO_KR_KEY' : process.env.KPX_SERVICE_KEY ? 'KPX_SERVICE_KEY (fallback)' : '(empty string — NO KEY)'}`)

  if (!dataGoKrKey) {
    console.warn('\n⚠️  No data.go.kr key found — KOTRA requests will be unauthenticated (expect 400/SERVICE_KEY error).')
  }

  // ── 1. KOTRA 국가정보 ── country profile for Vietnam (VN) ─────────────────
  // Org code: B410001
  // Endpoint: /kotra_nationalInformation/natnInfo/natnInfo
  // Required params: serviceKey, type=json, isoWd2CntCd (ISO-2 country code)
  const nationParams = new URLSearchParams({
    serviceKey: dataGoKrKey,
    type: 'json',
    isoWd2CntCd: 'VN',
  })
  await probeRaw(
    'KOTRA 국가정보 — VN (베트남) [B410001/kotra_nationalInformation/natnInfo/natnInfo]',
    `https://apis.data.go.kr/B410001/kotra_nationalInformation/natnInfo/natnInfo?${nationParams.toString()}`
  )

  // ── 2. KOTRA 상품DB ── commodity / product database ────────────────────────
  // Org code: B410001
  // Endpoint: /cmmdtDb/cmmdtDb
  // Required params: serviceKey, type=json, numOfRows, pageNo
  // Optional:  search1=country (e.g. 베트남), search2=title
  const productParams = new URLSearchParams({
    serviceKey: dataGoKrKey,
    type: 'json',
    numOfRows: '5',
    pageNo: '1',
  })
  await probeRaw(
    'KOTRA 상품DB (no filter) [B410001/cmmdtDb/cmmdtDb]',
    `https://apis.data.go.kr/B410001/cmmdtDb/cmmdtDb?${productParams.toString()}`
  )

  // ── 2b. 상품DB filtered by country = 베트남 ────────────────────────────────
  const productVnParams = new URLSearchParams({
    serviceKey: dataGoKrKey,
    type: 'json',
    numOfRows: '5',
    pageNo: '1',
    search1: '베트남',
  })
  await probeRaw(
    'KOTRA 상품DB (search1=베트남) [B410001/cmmdtDb/cmmdtDb]',
    `https://apis.data.go.kr/B410001/cmmdtDb/cmmdtDb?${productVnParams.toString()}`
  )

  // ── 3. KoreaExim 환율 (sanity check via same key path as tourist mode) ─────
  const today = (() => {
    const ms = Date.now() + 9 * 3_600_000
    const d = new Date(ms)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}${m}${day}`
  })()
  await probeRaw(
    `KoreaExim 환율 (date=${today}) [oapi.koreaexim.go.kr]`,
    `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${koreaeximKey}&searchdate=${today}&data=AP01`
  )

  console.log(`\n${'═'.repeat(70)}`)
  console.log('Probe complete.')
}

main().catch((e) => {
  console.error('Probe failed:', e)
  process.exit(1)
})
