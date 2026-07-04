/** Throwaway probe — KPX SMP areaName values (no Jeju filter). Delete when done. */
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
  numOfRows: '48',
  dataType: 'JSON',
  date: today,
})
const url = `https://apis.data.go.kr/B552115/SmpWithForecastDemand/getSmpWithForecastDemand?${params}`

console.log('URL (key redacted):', url.replace(/serviceKey=[^&]+/, 'serviceKey=***'))
console.log('date:', today)

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
console.log('item count:', list.length)

const areaNames = [...new Set(list.map((it) => String(it.areaName ?? '').trim()).filter(Boolean))]
console.log('\nDISTINCT areaName values (' + areaNames.length + '):', areaNames)

console.log('\nSample rows (up to 3):')
for (const row of list.slice(0, 3)) {
  console.log(JSON.stringify(row, null, 2))
}
