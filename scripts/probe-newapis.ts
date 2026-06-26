/**
 * Throwaway probe — inspects raw responses from newly-approved data.go.kr APIs.
 *
 * PURPOSE: shape reconnaissance BEFORE writing lib/jeju/connectors.ts adapters.
 * DO NOT import from lib/jeju or any app module. Standalone only.
 *
 * Run:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/probe-newapis.ts
 *
 * Probed APIs (all free, data.go.kr):
 *   1. KPX 계통한계가격 및 수요예측(하루전 발전계획용) — B552115/SmpWithForecastDemand
 *   2. KPX 발전원별 발전량(계통기준)                   — B552115/PwrAmountByGen
 *   3. 기상청 기상특보 조회서비스                        — 1360000/WthrWrnInfoService
 *   4a. 기상청 관광코스별 관광지 상세 날씨 — getTourStnVilageFcst (COURSE_ID probe)
 *   4b. 기상청 관광코스별 관광지 상세 날씨 — getCityTourClmIdx1  (city-code probe)
 */

const FETCH_TIMEOUT_MS = 10_000
const RAW_TEXT_PREVIEW = 3_000

/** KST today as YYYYMMDD. Computed once at startup. */
function todayKST(): string {
  const now = new Date()
  // Korea is UTC+9, no DST.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** KST current hour as 'HH'. */
function currentHourKST(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return String(kst.getUTCHours()).padStart(2, '0')
}

/** Fetch a URL with timeout; never throws. Returns status + raw body text. */
async function probe(
  label: string,
  url: string,
  note?: string
): Promise<void> {
  const divider = '═'.repeat(70)
  const thin = '─'.repeat(70)
  console.log(`\n${divider}`)
  console.log(`PROBE: ${label}`)
  if (note) console.log(`NOTE:  ${note}`)
  console.log(`URL:   ${url}`)
  console.log(thin)

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
        Accept: 'application/json,text/json,application/xml,text/xml,*/*;q=0.8',
      },
    })
    status = res.status
    body = await res.text()
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    fetchError = aborted
      ? `TIMEOUT after ${FETCH_TIMEOUT_MS}ms`
      : `FETCH ERROR: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    clearTimeout(timer)
  }

  if (fetchError) {
    console.log(`STATUS: ${fetchError}`)
    return
  }

  console.log(`STATUS: HTTP ${status}`)

  // Pretty-print JSON when possible; otherwise show first RAW_TEXT_PREVIEW chars.
  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      console.log('FORMAT: JSON')
      console.log(JSON.stringify(parsed, null, 2))
      return
    } catch {
      // Fall through to raw text
    }
  }

  console.log('FORMAT: non-JSON (XML or error text)')
  if (trimmed.length > RAW_TEXT_PREVIEW) {
    console.log(trimmed.slice(0, RAW_TEXT_PREVIEW))
    console.log(`\n... [${trimmed.length - RAW_TEXT_PREVIEW} more chars truncated]`)
  } else {
    console.log(trimmed)
  }
}

async function main(): Promise<void> {
  const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
  const today = todayKST()
  const hour = currentHourKST()

  if (!key) {
    console.error('ERROR: neither DATA_GO_KR_KEY nor KPX_SERVICE_KEY is set in env.')
    process.exit(1)
  }

  console.log('Jeju public-data API shape probe')
  console.log(`KST date: ${today}  hour: ${hour}`)
  console.log(`Key (first 8 chars): ${key.slice(0, 8)}...`)

  // ── 1. KPX SMP (계통한계가격 및 수요예측) ────────────────────────────────────
  // Approved on data.go.kr 2026-06-18. Endpoint: B552115/SmpWithForecastDemand.
  // Description says "육지 와 제주의 1시간 단위" — should have areaName field
  // separating mainland vs Jeju. Request numOfRows=48 to see both regions × 24h.
  {
    const params = new URLSearchParams({
      serviceKey: key,
      pageNo: '1',
      numOfRows: '48',
      dataType: 'JSON',
      date: today,
    })
    await probe(
      '1. KPX 계통한계가격 및 수요예측(하루전 발전계획용)',
      `https://apis.data.go.kr/B552115/SmpWithForecastDemand/getSmpWithForecastDemand?${params}`,
      '육지/제주 구분 여부 확인 → areaName 필드 주목. numOfRows=48 (24h×2 regions)'
    )
  }

  // ── 2. KPX 발전원별 발전량(계통기준) ─────────────────────────────────────────
  // Approved on data.go.kr 2026-06-19. Endpoint: B552115/PwrAmountByGen.
  // Description says "This data is data for mainland + Jeju" — likely combined only.
  // Fields expected: baseDatetime, fuelPwr1(수력)~fuelPwr9(태양광), fuelPwrTot, rn.
  {
    const params = new URLSearchParams({
      serviceKey: key,
      pageNo: '1',
      numOfRows: '30',
      dataType: 'JSON',
      baseDate: today,
    })
    await probe(
      '2. KPX 발전원별 발전량(계통기준)',
      `https://apis.data.go.kr/B552115/PwrAmountByGen/getPwrAmountByGen?${params}`,
      '제주/육지 분리 여부 확인 → 항목에 구분/region 필드가 있는지 주목. 없으면 전국 합산값.'
    )
  }

  // ── 3. 기상청 기상특보 조회서비스 ─────────────────────────────────────────────
  // Endpoint: 1360000/WthrWrnInfoService/getWthrWrnList
  // stnId=184 is Jeju (제주). Auto-approved on data.go.kr.
  // NOTE: when no active 특보 exists, the response may have 0 items — that is still
  // diagnostic (shows the envelope/item schema).
  {
    const params = new URLSearchParams({
      ServiceKey: key,
      pageNo: '1',
      numOfRows: '20',
      dataType: 'JSON',
      stnId: '184',
    })
    await probe(
      '3. 기상청 기상특보 조회서비스 (제주 stnId=184)',
      `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?${params}`,
      'stnId=184 = 제주. 현재 특보 없으면 items 0건이지만 envelope/schema는 볼 수 있음.'
    )
  }

  // Also probe WITHOUT stnId to see nationwide response shape.
  {
    const params = new URLSearchParams({
      ServiceKey: key,
      pageNo: '1',
      numOfRows: '10',
      dataType: 'JSON',
    })
    await probe(
      '3b. 기상청 기상특보 (전국, stnId 없음)',
      `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?${params}`,
      'stnId 없이 전국 조회 → items 형태 확인'
    )
  }

  // ── 4a. 기상청 관광코스별 관광지 상세 날씨 — getTourStnVilageFcst ───────────
  // Endpoint: 1360000/TourStnInfoService/getTourStnVilageFcst
  // Requires COURSE_ID. COURSE_ID for Jeju spots are in the KMA reference doc
  // (기상청27_관광코스별_관광지_상세설명서.zip) which we don't have at probe time.
  // Strategy: try several candidate IDs that are likely Jeju-range codes.
  // Even an empty-data or error response shows the expected param shape.
  for (const courseId of ['1601', '1701', '1001', '0101']) {
    const params = new URLSearchParams({
      ServiceKey: key,
      CURRENT_DATE: today,
      HOUR: hour,
      COURSE_ID: courseId,
      pageNo: '1',
      numOfRows: '12',
      dataType: 'JSON',
    })
    await probe(
      `4a. 기상청 관광코스별 날씨 — getTourStnVilageFcst (COURSE_ID=${courseId})`,
      `https://apis.data.go.kr/1360000/TourStnInfoService/getTourStnVilageFcst?${params}`,
      `COURSE_ID=${courseId} is a best-guess for Jeju area. KMA doc needed for exact IDs.`
    )
  }

  // ── 4b. 기상청 관광코스별 — getCityTourClmIdx1 (시군구별 관광기후지수) ────────
  // This sub-endpoint takes a 시군구 code instead of a COURSE_ID.
  // 제주시 행정코드: 5011000000 (제주특별자치도 제주시)
  // 서귀포시:        5013000000
  {
    const params = new URLSearchParams({
      ServiceKey: key,
      CURRENT_DATE: today,
      DAY: '3',
      CITY_ID: '5011000000',
      pageNo: '1',
      numOfRows: '10',
      dataType: 'JSON',
    })
    await probe(
      '4b. 기상청 시군구별 관광기후지수 — getCityTourClmIdx1 (제주시 5011000000)',
      `https://apis.data.go.kr/1360000/TourStnInfoService/getCityTourClmIdx1?${params}`,
      '시군구코드 5011000000 = 제주시. DAY=3 (3일치). CITY_ID param name may differ — watch error.'
    )
  }

  // Also try 서귀포시 city code.
  {
    const params = new URLSearchParams({
      ServiceKey: key,
      CURRENT_DATE: today,
      DAY: '3',
      CITY_ID: '5013000000',
      pageNo: '1',
      numOfRows: '10',
      dataType: 'JSON',
    })
    await probe(
      '4c. 기상청 시군구별 관광기후지수 — getCityTourClmIdx1 (서귀포시 5013000000)',
      `https://apis.data.go.kr/1360000/TourStnInfoService/getCityTourClmIdx1?${params}`,
      '시군구코드 5013000000 = 서귀포시.'
    )
  }

  console.log('\n' + '═'.repeat(70))
  console.log('Probe complete.')
}

main().catch((err: unknown) => {
  console.error('Uncaught error:', err)
  process.exit(1)
})
