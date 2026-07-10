/**
 * One-off: merge data.go.kr 클린하우스 CSVs → lib/jeju/data/cleanhouse.json
 *
 * Inputs (EUC-KR or UTF-8):
 *   scripts/raw/jeju-city-cleanhouse.csv   — dataset 15110514 (~1,359 rows)
 *   scripts/raw/seogwipo-cleanhouse.csv    — dataset 15056472 (~388 rows; often no lat/lng)
 *
 * Run:
 *   npx tsx scripts/build-cleanhouse.ts
 */

import fs from 'fs'
import path from 'path'
import Papa from 'papaparse'

const ROOT = path.resolve(__dirname, '..')
const RAW = path.join(ROOT, 'scripts', 'raw')
const OUT = path.join(ROOT, 'lib', 'jeju', 'data', 'cleanhouse.json')

const JEJU_CITY = path.join(RAW, 'jeju-city-cleanhouse.csv')
const SEOGWIPO = path.join(RAW, 'seogwipo-cleanhouse.csv')

const LAT_MIN = 33.1
const LAT_MAX = 33.6
const LNG_MIN = 126.1
const LNG_MAX = 126.98

export interface CleanCenterRow {
  name: string
  dong: string
  address: string
  /** Human-readable landmark (위치 / 단지명) — primary recognition cue for users */
  landmark: string | null
  lat: number | null
  lng: number | null
  items: string[]
  hours: string
  type: string
}

function readCsvText(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString('utf8').slice(1)
  }
  const asUtf8 = buf.toString('utf8')
  const firstLine = asUtf8.split(/\r?\n/)[0] ?? ''
  if (/[\uac00-\ud7a3]/.test(firstLine)) return asUtf8
  return new TextDecoder('euc-kr').decode(buf)
}

function parseCsv(filePath: string): Record<string, string>[] {
  const text = readCsvText(filePath)
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })
  if (result.errors.length) {
    console.warn(`[parse] ${path.basename(filePath)}: ${result.errors.length} parse warning(s)`)
  }
  return result.data
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function validJejuCoord(lat: number, lng: number): boolean {
  return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX
}

function pickCoord(row: Record<string, string>, latKeys: string[], lngKeys: string[]): { lat: number; lng: number } | null {
  let lat: number | null = null
  let lng: number | null = null
  for (const k of latKeys) {
    if (row[k] != null && String(row[k]).trim()) {
      lat = parseNum(row[k])
      if (lat != null) break
    }
  }
  for (const k of lngKeys) {
    if (row[k] != null && String(row[k]).trim()) {
      lng = parseNum(row[k])
      if (lng != null) break
    }
  }
  if (lat == null || lng == null) return null
  if (!validJejuCoord(lat, lng)) return null
  return { lat, lng }
}

function inferType(...parts: string[]): string {
  const s = parts.join(' ')
  if (/재활용\s*도움\s*센터|재활용센터|재활용장|재활용도움/.test(s)) return '재활용도움센터'
  return '클린하우스'
}

function buildName(dong: string, label: string, type: string): string {
  const d = dong.trim()
  const l = label.trim()
  if (!l) return d || '클린하우스'
  if (l.includes(d) || d.includes(l)) return l
  if (/클린하우스|재활용/.test(l)) return `${d} ${l}`.trim()
  return type === '재활용도움센터' ? `${d} ${l}`.trim() : `${d} ${l}`.trim()
}

function itemsFromJejuRow(row: Record<string, string>): string[] {
  const n = (key: string) => parseNum(row[key]) ?? 0
  const items: string[] = []
  if (n('종량제 수거함 수') > 0) items.push('일반쓰레기')
  if (n('재활용 수거함 수') > 0) items.push('재활용')
  if (n('유리병 수거함 수') > 0) items.push('빈병')
  if (n('스티로폼 수거함 수') > 0) items.push('스티로폼')
  if (n('폐기 건전지 수거함 수') > 0) items.push('폐건전지')
  if (n('폐기 형광등 수거함 수') > 0) items.push('폐형광등')
  if (n('음식물 수거함 수') > 0 || n('음식물 계량 수거함 수') > 0) items.push('음식물')
  return items
}

function parseJejuCity(rows: Record<string, string>[]): { centers: CleanCenterRow[]; skipped: number } {
  const centers: CleanCenterRow[] = []
  let skipped = 0
  for (const row of rows) {
    const dong = String(row['읍면동 명'] ?? '').trim()
    const address = String(row['도로명 주소'] ?? '').trim()
    const complex = String(row['단지 명'] ?? '').trim()
    const coord = pickCoord(row, ['위도 좌표', '위도좌표', '위도'], ['경도 좌표', '경도좌표', '경도'])
    if (!coord || !dong || !address) {
      skipped++
      continue
    }
    const type = inferType(complex, address)
    const landmark = complex || null
    const name = buildName(dong, complex || '클린하우스', type)
    const items = itemsFromJejuRow(row)
    centers.push({
      name,
      dong,
      address,
      landmark,
      lat: coord.lat,
      lng: coord.lng,
      items,
      hours: '상시',
      type,
    })
  }
  return { centers, skipped }
}

function parseSeogwipo(rows: Record<string, string>[]): {
  centers: CleanCenterRow[]
  skipped: number
  withCoords: number
  addressOnly: number
} {
  const centers: CleanCenterRow[] = []
  let skipped = 0
  let withCoords = 0
  let addressOnly = 0
  for (const row of rows) {
    const dong = String(row['읍면동'] ?? row['읍면동 명'] ?? '').trim()
    const spot = String(row['위치'] ?? row['단지 명'] ?? row['단지명'] ?? '').trim()
    const address = String(row['인근주소'] ?? row['도로명 주소'] ?? row['도로명·지번 주소'] ?? '').trim()
    if (!dong || !address) {
      skipped++
      continue
    }
    const coord = pickCoord(
      row,
      ['위도 좌표', '위도좌표', '위도', '위도·경도 좌표'],
      ['경도 좌표', '경도좌표', '경도'],
    )
    const landmark = spot || null
    const name = landmark || `${dong} 클린하우스`
    if (coord) {
      withCoords++
    } else {
      addressOnly++
    }
    centers.push({
      name,
      dong,
      address,
      landmark,
      lat: coord?.lat ?? null,
      lng: coord?.lng ?? null,
      items: [],
      hours: '상시',
      type: '클린하우스',
    })
  }
  return { centers, skipped, withCoords, addressOnly }
}

function main(): void {
  if (!fs.existsSync(JEJU_CITY)) {
    console.error(`Missing ${JEJU_CITY}`)
    process.exit(1)
  }

  const cityRows = parseCsv(JEJU_CITY)
  const cityHeaders = Object.keys(cityRows[0] ?? {})
  console.log('제주시 CSV headers:', cityHeaders.join(' | '))
  console.log('제주시 raw rows:', cityRows.length)

  const city = parseJejuCity(cityRows)
  console.log(`제주시 included: ${city.centers.length}, skipped: ${city.skipped}`)

  let seogwipo = { centers: [] as CleanCenterRow[], skipped: 0, withCoords: 0, addressOnly: 0 }
  if (fs.existsSync(SEOGWIPO)) {
    const sgRows = parseCsv(SEOGWIPO)
    const sgHeaders = Object.keys(sgRows[0] ?? {})
    console.log('서귀포 CSV headers:', sgHeaders.join(' | '))
    console.log('서귀포 raw rows:', sgRows.length)
    seogwipo = parseSeogwipo(sgRows)
    console.log(
      `서귀포 included: ${seogwipo.centers.length}, skipped: ${seogwipo.skipped}` +
        ` (coords: ${seogwipo.withCoords}, address-only: ${seogwipo.addressOnly})`,
    )
  } else {
    console.warn('서귀포 CSV 없음 — 제주시만 병합')
  }

  const centers = [...city.centers, ...seogwipo.centers]
  centers.sort((a, b) => a.dong.localeCompare(b.dong, 'ko') || a.name.localeCompare(b.name, 'ko'))

  const withCoords = centers.filter((c) => c.lat != null && c.lng != null).length
  const addressOnly = centers.length - withCoords

  const payload = {
    _note:
      'Official data.go.kr — 제주시(15110514, 좌표+수거함) + 서귀포시(15056472, 주소 목록). ' +
      'Generated by scripts/build-cleanhouse.ts. Seogwipo rows may have lat/lng null.',
    centers,
  }

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')

  const sample = centers.find((c) => c.lat == null) ?? centers[0]
  const sgSamples = centers.filter((c) => c.lat == null).slice(0, 3)
  console.log('\n── sample (encoding check) ──')
  console.log(JSON.stringify(sample, null, 2))
  if (sgSamples.length) {
    console.log('\n── 서귀포 samples (landmark + address) ──')
    for (const s of sgSamples) {
      console.log(`  ${s.dong} | landmark: ${s.landmark} | 주소: ${s.address}`)
    }
  }
  console.log('\n── result ──')
  console.log(`Wrote ${centers.length} centers → ${OUT}`)
  console.log(`  nearest-capable (lat/lng): ${withCoords}`)
  console.log(`  address-only (no coords):  ${addressOnly}`)
  console.log(`  제주시: ${city.centers.length}`)
  console.log(`  서귀포: ${seogwipo.centers.length}`)
}

main()
