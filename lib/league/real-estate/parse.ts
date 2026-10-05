/**
 * Parsers for official housing-index payloads. No network. No keys.
 */

export type ParsedPoint = {
  refPeriod: string
  value: number
  areaCode?: string
  areaName?: string
  seriesId: string
}

export function parseFredObservations(body: unknown, seriesId: string): ParsedPoint[] {
  const observations = (body as { observations?: unknown })?.observations
  if (!Array.isArray(observations)) return []
  const out: ParsedPoint[] = []
  for (const row of observations) {
    if (!row || typeof row !== 'object') continue
    const date = String((row as { date?: unknown }).date ?? '')
    const raw = String((row as { value?: unknown }).value ?? '')
    const period = /^(\d{4})-(\d{2})/.exec(date)
    const value = Number(raw)
    if (!period || !Number.isFinite(value)) continue
    out.push({ refPeriod: `${period[1]}-${period[2]}`, value, seriesId })
  }
  return out
}

export function parseUkHpiCsv(csv: string): ParsedPoint[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []
  const header = splitCsv(lines[0]!).map((cell) => cell.trim().toLowerCase())
  const dateIdx = header.findIndex((cell) => cell === 'date')
  const areaIdx = header.findIndex((cell) => cell === 'areacode' || cell === 'area_code')
  const indexIdx = header.findIndex((cell) => cell === 'index')
  if (dateIdx < 0 || areaIdx < 0 || indexIdx < 0) return []
  const out: ParsedPoint[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line)
    const period = /^(\d{4})-(\d{2})/.exec(cells[dateIdx] ?? '')
    const area = (cells[areaIdx] ?? '').trim()
    const value = Number(cells[indexIdx])
    if (!period || !area || !Number.isFinite(value)) continue
    out.push({ refPeriod: `${period[1]}-${period[2]}`, value, areaCode: area, seriesId: 'UK-HPI' })
  }
  return out
}

export type RoneRow = {
  refPeriod: string
  value: number
  clsId: string
  clsName: string
}

export function parseRoneTable(body: unknown): RoneRow[] {
  const root = (body as { SttsApiTblData?: unknown })?.SttsApiTblData
  const blocks = Array.isArray(root) ? root : []
  const rowBlock = blocks.find((block) => block && typeof block === 'object' && 'row' in (block as object)) as
    | { row?: unknown }
    | undefined
  const rows = asArray(rowBlock?.row)
  const out: RoneRow[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const period = ronePeriod(String(rec.WRTTIME_IDTFR_ID ?? ''), String(rec.WRTTIME_DESC ?? ''))
    const value = Number(rec.DTA_VAL)
    const clsId = String(rec.CLS_ID ?? '')
    const clsName = String(rec.CLS_NM ?? rec.CLS_FULLNM ?? '')
    if (!period || !Number.isFinite(value)) continue
    out.push({ refPeriod: period, value, clsId, clsName })
  }
  return out
}

export type EstatPoint = ParsedPoint & { categoryName: string }

export function parseEstatHousing(body: unknown, seriesId: string): EstatPoint[] {
  const data = estatValueNodes(body)
  const names = estatAreaNames(body)
  const categories = estatCategoryNames(body)
  const out: EstatPoint[] = []
  for (const node of data) {
    if (!node || typeof node !== 'object') continue
    const rec = node as Record<string, unknown>
    const period = estatPeriod(String(rec['@time'] ?? ''))
    const value = Number(rec.$)
    const areaCode = String(rec['@area'] ?? '')
    const cat = String(rec['@cat01'] ?? '')
    const categoryName = categories.get(cat) ?? ''
    if (!period || !Number.isFinite(value)) continue
    if (categoryName && !/住宅総合|住宅総合指数/.test(categoryName)) continue
    out.push({
      refPeriod: period,
      value,
      areaCode,
      areaName: names.get(areaCode) ?? '',
      seriesId,
      categoryName,
    })
  }
  return out
}

const ESTAT_AREA_TO_CATALOG: ReadonlyArray<readonly [RegExp, string]> = [
  [/全国/, 'NAT'],
  [/北海道/, 'HOKKAIDO'],
  [/東北/, 'TOHOKU'],
  [/南関東/, 'SOUTH_KANTO'],
  [/関東/, 'KANTO'],
  [/北陸/, 'HOKURIKU'],
  [/名古屋/, 'NAGOYA'],
  [/中部/, 'CHUBU'],
  [/京阪神/, 'KEIHANSHIN'],
  [/近畿/, 'KINKI'],
  [/中国/, 'CHUGOKU'],
  [/四国/, 'SHIKOKU'],
  [/九州/, 'KYUSHU'],
  [/東京都/, '13'],
  [/愛知県/, '23'],
  [/大阪府/, '27'],
]

export function catalogRegionForEstatArea(areaName: string): string | null {
  for (const [pattern, code] of ESTAT_AREA_TO_CATALOG) {
    if (pattern.test(areaName)) return code
  }
  return null
}

export function catalogRegionForRoneName(name: string): string | null {
  const compact = name.replace(/\s+/g, '')
  if (/전국|전국평균/.test(compact)) return 'NAT'
  const table: ReadonlyArray<readonly [string, string]> = [
    ['서울특별시', '11'],
    ['서울', '11'],
    ['부산', '26'],
    ['대구', '27'],
    ['인천', '28'],
    ['광주', '29'],
    ['대전', '30'],
    ['울산', '31'],
    ['세종', '36'],
    ['경기', '41'],
    ['강원', '51'],
    ['충북', '43'],
    ['충남', '44'],
    ['전북', '52'],
    ['전남', '46'],
    ['경북', '47'],
    ['경남', '48'],
    ['제주', '50'],
    ['서울중구', '11140'],
    ['종로구', '11110'],
    ['용산구', '11170'],
    ['성동구', '11200'],
    ['광진구', '11215'],
    ['동대문구', '11230'],
    ['중랑구', '11260'],
    ['성북구', '11290'],
    ['강북구', '11305'],
    ['도봉구', '11320'],
    ['노원구', '11350'],
    ['은평구', '11380'],
    ['서대문구', '11410'],
    ['마포구', '11440'],
    ['양천구', '11470'],
    ['강서구', '11500'],
    ['구로구', '11530'],
    ['금천구', '11545'],
    ['영등포구', '11560'],
    ['동작구', '11590'],
    ['관악구', '11620'],
    ['서초구', '11650'],
    ['강남구', '11680'],
    ['송파구', '11710'],
    ['강동구', '11740'],
    ['해운대구', '26350'],
    ['금정구', '26410'],
    ['수영구', '26500'],
    ['동래구', '26260'],
    ['부산진구', '26230'],
    ['연수구', '28185'],
    ['남동구', '28200'],
    ['부평구', '28237'],
    ['분당구', '41135'],
    ['수정구', '41131'],
    ['중원구', '41133'],
    ['장안구', '41111'],
    ['권선구', '41113'],
    ['팔달구', '41115'],
    ['영통구', '41117'],
    ['기흥구', '41463'],
    ['수지구', '41465'],
    ['처인구', '41461'],
    ['일산동구', '41285'],
    ['일산서구', '41287'],
    ['덕양구', '41281'],
    ['의정부', '41150'],
    ['화성', '41590'],
  ]
  let best: string | null = null
  let bestLen = 0
  for (const [label, code] of table) {
    if (compact.includes(label) && label.length > bestLen) {
      best = code
      bestLen = label.length
    }
  }
  return best
}

export function redactHousingSecrets(text: string): string {
  return text
    .replace(/api_key=[^&\s]+/gi, 'api_key=REDACTED')
    .replace(/([?&]KEY=)[^&\s]+/g, '$1REDACTED')
    .replace(/appId=[^&\s]+/gi, 'appId=REDACTED')
}

function ronePeriod(id: string, desc: string): string | null {
  const fromId = /^(\d{4})(\d{2})$/.exec(id.trim())
  if (fromId) return `${fromId[1]}-${fromId[2]}`
  const fromDesc = /(\d{4})\D+(\d{1,2})/.exec(desc)
  if (!fromDesc) return null
  return `${fromDesc[1]}-${fromDesc[2]!.padStart(2, '0')}`
}

function estatPeriod(time: string): string | null {
  const match = /^(\d{4})(\d{2})/.exec(time)
  if (!match || match[2] === '00') return null
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return `${match[1]}-${match[2]}`
}

function estatValueNodes(body: unknown): unknown[] {
  const root = (body as { GET_STATS_DATA?: { STATISTICAL_DATA?: { DATA_INF?: { VALUE?: unknown } } } })?.GET_STATS_DATA
  return asArray(root?.STATISTICAL_DATA?.DATA_INF?.VALUE)
}

function estatAreaNames(body: unknown): Map<string, string> {
  return estatClassNames(body, 'area')
}

function estatCategoryNames(body: unknown): Map<string, string> {
  return estatClassNames(body, 'cat01')
}

function estatClassNames(body: unknown, id: string): Map<string, string> {
  const classInf = (
    body as {
      GET_STATS_DATA?: { STATISTICAL_DATA?: { CLASS_INF?: { CLASS_OBJ?: unknown } } }
    }
  )?.GET_STATS_DATA?.STATISTICAL_DATA?.CLASS_INF?.CLASS_OBJ
  const objects = asArray(classInf)
  const map = new Map<string, string>()
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue
    const rec = obj as { '@id'?: string; CLASS?: unknown }
    if (rec['@id'] !== id) continue
    for (const item of asArray(rec.CLASS)) {
      if (!item || typeof item !== 'object') continue
      const row = item as { '@code'?: string; '@name'?: string }
      if (row['@code']) map.set(row['@code'], row['@name'] ?? '')
    }
  }
  return map
}

function asArray(value: unknown): unknown[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function splitCsv(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (ch === ',' && !quoted) {
      cells.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current)
  return cells
}
