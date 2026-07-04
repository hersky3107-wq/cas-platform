/** Throwaway probe — KPX 발전원별 발전량(계통기준). Delete when done. */
function kstYmd(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`
}

const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
if (!key) {
  console.error('No DATA_GO_KR_KEY or KPX_SERVICE_KEY in env')
  process.exit(1)
}

const today = kstYmd()
const params = new URLSearchParams({
  serviceKey: key,
  pageNo: '1',
  numOfRows: '30',
  dataType: 'JSON',
  baseDate: today,
})
const url = `https://apis.data.go.kr/B552115/PwrAmountByGen/getPwrAmountByGen?${params}`

console.log('URL (key redacted):', url.replace(/serviceKey=[^&]+/, 'serviceKey=***'))
console.log('baseDate:', today)

const res = await fetch(url)
const text = await res.text()
console.log('HTTP status:', res.status)

let parsed
try {
  parsed = JSON.parse(text)
} catch {
  console.log('RAW (not JSON):', text.slice(0, 2000))
  process.exit(0)
}

const header = parsed?.response?.header ?? parsed?.header ?? {}
const body = parsed?.response?.body ?? parsed?.body ?? {}
const items = body?.items?.item ?? body?.items ?? []
const list = Array.isArray(items) ? items : items ? [items] : []

console.log('resultCode:', header.resultCode ?? '(missing)')
console.log('resultMsg:', header.resultMsg ?? '(missing)')
console.log('totalCount:', body.totalCount ?? '(missing)')
console.log('item count:', list.length)
if (list[0]) console.log('first item keys:', Object.keys(list[0]))
if (list[0]) console.log('first item sample:', JSON.stringify(list[0], null, 2))

const raw = JSON.stringify(parsed, null, 2)
console.log('\n--- FULL RAW (or first 2000 chars) ---')
console.log(raw.length > 2000 ? raw.slice(0, 2000) + '\n...[truncated]' : raw)
