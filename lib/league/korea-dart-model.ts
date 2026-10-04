/**
 * OpenDART facts for the KRSTOCK packet. Pure — no network, no DB, no key.
 * Raw statement amounts stay here only long enough to derive ratios.
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export const DART_DISCLOSURE_TTL_MS = 6 * 60 * 60 * 1000
export const DART_FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000

export const DART_DISCLOSURE_TYPES = [
  'earnings',
  'rights_issue',
  'convertible_bond',
  'large_contract',
  'mna',
  'treasury_stock',
  'major_shareholder',
  'amended_filing',
  'investor_warning',
  'other',
] as const

export type DartDisclosureType = (typeof DART_DISCLOSURE_TYPES)[number]

export type DisclosureItem = {
  date: string
  type: DartDisclosureType
  title: string
}

export type DisclosurePayload = {
  ok: true
  items: DisclosureItem[]
}

export type FundamentalsPayload = {
  ok: true
  newestRceptNo: string | null
  revenueYoy: number | null
  operatingMargin: number | null
  debtRatio: number | null
  basis: 'consolidated' | 'separate' | null
  annualFilingDate: string | null
  quarterFilingDates: string[]
}

export type DartAccountRow = {
  reprtCode: string
  bsnsYear: string
  rceptNo: string
  fsDiv: 'CFS' | 'OFS'
  accountNm: string
  thstrmAmount: string | null
  frmtrmAmount: string | null
}

export type DartCorpListing = {
  corpCode: string
  corpName: string
  stockCode: string
  modifyDate: string
}

export type MappedDartCorp = {
  stockCode: string
  corpCode: string
  corpName: string
}

const TYPE_LABEL: Record<DartDisclosureType, string> = {
  earnings: 'earnings',
  rights_issue: 'rights issue',
  convertible_bond: 'convertible or exchangeable bonds',
  large_contract: 'large contract',
  mna: 'M&A',
  treasury_stock: 'treasury stock',
  major_shareholder: 'major shareholder change',
  amended_filing: 'amended filing',
  investor_warning: 'investor warning',
  other: 'other',
}

const REVENUE_KEYS = ['매출액', '수익(매출액)', '영업수익', '매출액(수익)']

export function dartYmdWindow(now: Date, daysBack: number): { bgnDe: string; endDe: string } {
  const endDe = formatInTimeZone(now, 'Asia/Seoul', 'yyyyMMdd')
  const endDate = formatInTimeZone(now, 'Asia/Seoul', 'yyyy-MM-dd')
  const anchor = fromZonedTime(`${endDate}T12:00:00`, 'Asia/Seoul')
  anchor.setUTCDate(anchor.getUTCDate() - daysBack)
  const bgnDe = formatInTimeZone(anchor, 'Asia/Seoul', 'yyyyMMdd')
  return { bgnDe, endDe }
}

export function dartYmdToIso(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  const probe = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(probe.getTime())) return null
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null
  return iso
}

export function isDartCacheFresh(
  kind: 'disclosures' | 'fundamentals',
  fetchedAt: string,
  now: Date,
): boolean {
  const t = Date.parse(fetchedAt)
  if (!Number.isFinite(t)) return false
  const ttl = kind === 'disclosures' ? DART_DISCLOSURE_TTL_MS : DART_FUNDAMENTALS_TTL_MS
  return now.getTime() - t < ttl
}

export type DartFetchPlan = {
  disclosures: 'use_cache' | 'fetch'
  fundamentals: 'use_cache' | 'probe' | 'fetch'
}

export function planDartFetches(args: {
  now: Date
  disclosuresFetchedAt: string | null
  fundamentalsFetchedAt: string | null
  fundamentalsHavePayload: boolean
}): DartFetchPlan {
  const disclosuresFresh =
    args.disclosuresFetchedAt != null && isDartCacheFresh('disclosures', args.disclosuresFetchedAt, args.now)
  const fundamentalsFresh =
    args.fundamentalsFetchedAt != null && isDartCacheFresh('fundamentals', args.fundamentalsFetchedAt, args.now)
  return {
    disclosures: disclosuresFresh ? 'use_cache' : 'fetch',
    fundamentals: fundamentalsFresh ? 'use_cache' : args.fundamentalsHavePayload ? 'probe' : 'fetch',
  }
}

export function dartStatusKind(body: unknown): 'ok' | 'empty' | 'fail' {
  if (!body || typeof body !== 'object') return 'fail'
  const status = (body as { status?: unknown }).status
  if (status === '000') return 'ok'
  if (status === '013') return 'empty'
  return 'fail'
}

function foldTitle(title: string): string {
  return title.replace(/\s+/g, '').replace(/ㆍ/g, '·').replace(/\(손실\)/g, '')
}

export function normalizeDisclosureType(title: string): DartDisclosureType {
  const folded = foldTitle(title)
  if (/투자경고|투자주의|투자위험|매매거래정지|거래정지|불성실공시|관리종목/.test(folded)) return 'investor_warning'
  if (/정정/.test(folded)) return 'amended_filing'
  if (/유상증자|무상증자|주주배정|제3자배정|일반공모증자/.test(folded)) return 'rights_issue'
  if (/전환사채|교환사채|신주인수권부사채/.test(folded)) return 'convertible_bond'
  if (/단일판매|공급계약|수주/.test(folded)) return 'large_contract'
  if (/합병|영업양수|영업양도|주식교환|공개매수|분할합병/.test(folded)) return 'mna'
  if (/자기주식|자사주/.test(folded)) return 'treasury_stock'
  if (/최대주주|대량보유|주요주주/.test(folded)) return 'major_shareholder'
  if (/잠정실적|영업실적|매출액또는손익|실적공시/.test(folded)) return 'earnings'
  return 'other'
}

export function disclosureLean(type: DartDisclosureType, title: string): 'up' | 'down' | null {
  const folded = foldTitle(title)
  if (type === 'investor_warning') return /해제|철회/.test(folded) ? 'up' : 'down'
  if (type === 'amended_filing') return 'down'
  if (type === 'rights_issue' || type === 'convertible_bond') return 'down'
  if (type === 'large_contract') return /해지|취소/.test(folded) ? 'down' : 'up'
  if (type === 'treasury_stock') {
    if (/처분|매각/.test(folded)) return 'down'
    if (/취득|소각|매입/.test(folded)) return 'up'
    return null
  }
  if (type === 'mna') {
    if (/양도|매각/.test(folded)) return 'down'
    if (/인수|양수/.test(folded)) return 'up'
    return null
  }
  if (type === 'major_shareholder') {
    if (/감소|매도|처분/.test(folded)) return 'down'
    if (/증가|매수/.test(folded)) return 'up'
    return null
  }
  if (type === 'earnings') {
    if (/적자|쇼크|감소|부진/.test(folded)) return 'down'
    if (/흑자|서프라이즈|호실적|증가/.test(folded)) return 'up'
    return null
  }
  return null
}

function shortTitle(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (clean.length <= 80) return clean
  return `${clean.slice(0, 79)}…`
}

export function parseDisclosureList(body: unknown): DisclosureItem[] {
  if (!body || typeof body !== 'object') return []
  const list = (body as { list?: unknown }).list
  if (!Array.isArray(list)) return []
  const items: DisclosureItem[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { report_nm?: unknown; rcept_dt?: unknown }
    const title = typeof rec.report_nm === 'string' ? shortTitle(rec.report_nm) : ''
    const date = dartYmdToIso(typeof rec.rcept_dt === 'string' ? rec.rcept_dt : null)
    if (!title || !date) continue
    items.push({ date, type: normalizeDisclosureType(title), title })
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
  const seen = new Set<string>()
  const out: DisclosureItem[] = []
  for (const item of items) {
    const key = `${item.date}|${item.type}|${item.title}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= 40) break
  }
  return out
}

export function isDisclosurePayload(value: unknown): value is DisclosurePayload {
  if (!value || typeof value !== 'object') return false
  const row = value as { ok?: unknown; items?: unknown }
  return row.ok === true && Array.isArray(row.items)
}

export function isFundamentalsPayload(value: unknown): value is FundamentalsPayload {
  if (!value || typeof value !== 'object') return false
  const row = value as { ok?: unknown; newestRceptNo?: unknown }
  return row.ok === true && (row.newestRceptNo == null || typeof row.newestRceptNo === 'string')
}

export function packetAfterDisclosureFetch(args: {
  cacheFresh: boolean
  cached: DisclosurePayload | null
  fetchBody: unknown | 'skipped'
}): DisclosurePayload | 'unavailable' {
  if (args.cacheFresh && args.cached) return args.cached
  if (args.fetchBody === 'skipped') return args.cached ?? 'unavailable'
  const kind = dartStatusKind(args.fetchBody)
  if (kind === 'fail') return args.cached ?? 'unavailable'
  if (kind === 'empty') return { ok: true, items: [] }
  return { ok: true, items: parseDisclosureList(args.fetchBody) }
}

export function fundamentalsActionAfterProbe(args: {
  cachedNewestRceptNo: string | null
  probe: 'fail' | 'empty' | { newestRceptNo: string | null }
}): 'keep' | 'refetch' | 'unavailable' | 'empty' {
  if (args.probe === 'fail') return args.cachedNewestRceptNo ? 'keep' : 'unavailable'
  if (args.probe === 'empty') return args.cachedNewestRceptNo ? 'keep' : 'empty'
  const newest = args.probe.newestRceptNo
  if (!newest) return args.cachedNewestRceptNo ? 'keep' : 'unavailable'
  if (args.cachedNewestRceptNo && newest <= args.cachedNewestRceptNo) return 'keep'
  return 'refetch'
}

export function emptyFundamentals(): FundamentalsPayload {
  return {
    ok: true,
    newestRceptNo: null,
    revenueYoy: null,
    operatingMargin: null,
    debtRatio: null,
    basis: null,
    annualFilingDate: null,
    quarterFilingDates: [],
  }
}

export function classifyPeriodicTitle(
  title: string,
): { reprtCode: '11011' | '11012' | '11013' | '11014'; bsnsYear: string; periodEnd: string } | null {
  const m = title.match(/(사업보고서|반기보고서|분기보고서)[^\d]{0,12}(\d{4})\.(\d{2})/)
  if (!m) return null
  const kind = m[1]
  const year = m[2]!
  const month = m[3]!
  if (kind === '사업보고서') return { reprtCode: '11011', bsnsYear: year, periodEnd: `${year}-12-31` }
  if (kind === '반기보고서') return { reprtCode: '11012', bsnsYear: year, periodEnd: `${year}-06-30` }
  if (kind === '분기보고서' && month === '03') return { reprtCode: '11013', bsnsYear: year, periodEnd: `${year}-03-31` }
  if (kind === '분기보고서' && month === '09') return { reprtCode: '11014', bsnsYear: year, periodEnd: `${year}-09-30` }
  return null
}

export function selectFinancialReports(
  filings: readonly { reportNm: string; rceptNo: string }[],
): { reprtCode: string; bsnsYear: string; rceptNo: string; periodEnd: string }[] {
  const byKey = new Map<string, { reprtCode: string; bsnsYear: string; rceptNo: string; periodEnd: string }>()
  for (const filing of filings) {
    const classified = classifyPeriodicTitle(filing.reportNm)
    if (!classified) continue
    const key = `${classified.bsnsYear}:${classified.reprtCode}`
    const prev = byKey.get(key)
    if (!prev || filing.rceptNo > prev.rceptNo) byKey.set(key, { ...classified, rceptNo: filing.rceptNo })
  }
  const all = [...byKey.values()].sort(
    (a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.rceptNo.localeCompare(a.rceptNo),
  )
  const picked = all.slice(0, 4)
  const annual = all.find((row) => row.reprtCode === '11011')
  if (annual && !picked.some((row) => row.bsnsYear === annual.bsnsYear && row.reprtCode === annual.reprtCode)) {
    picked.push(annual)
  }
  return picked
}

export function newestPeriodicRceptNo(filings: readonly { reportNm: string; rceptNo: string }[]): string | null {
  let newest: string | null = null
  for (const filing of filings) {
    if (!classifyPeriodicTitle(filing.reportNm)) continue
    if (!newest || filing.rceptNo > newest) newest = filing.rceptNo
  }
  return newest
}

function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const cleaned = raw.replace(/,/g, '').replace(/[^\d.-]/g, '').trim()
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function accountKey(name: string): string {
  return name.replace(/\s+/g, '').replace(/\(손실\)/g, '')
}

function pickAmount(
  rows: readonly DartAccountRow[],
  keys: readonly string[],
  field: 'thstrmAmount' | 'frmtrmAmount',
): number | null {
  for (const key of keys) {
    const hit = rows.find((row) => accountKey(row.accountNm) === key)
    if (!hit) continue
    const n = parseAmount(hit[field])
    if (n != null) return n
  }
  return null
}

export function parseFnlttAccounts(body: unknown): DartAccountRow[] {
  if (dartStatusKind(body) !== 'ok' || !body || typeof body !== 'object') return []
  const list = (body as { list?: unknown }).list
  if (!Array.isArray(list)) return []
  const out: DartAccountRow[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const fs = rec.fs_div === 'CFS' || rec.fs_div === 'OFS' ? rec.fs_div : null
    if (!fs) continue
    const reprtCode = typeof rec.reprt_code === 'string' ? rec.reprt_code : ''
    const bsnsYear = typeof rec.bsns_year === 'string' ? rec.bsns_year : ''
    const rceptNo = typeof rec.rcept_no === 'string' ? rec.rcept_no : ''
    const accountNm = typeof rec.account_nm === 'string' ? rec.account_nm : ''
    if (!reprtCode || !rceptNo || !accountNm) continue
    out.push({
      reprtCode,
      bsnsYear,
      rceptNo,
      fsDiv: fs,
      accountNm,
      thstrmAmount: typeof rec.thstrm_amount === 'string' ? rec.thstrm_amount : null,
      frmtrmAmount: typeof rec.frmtrm_amount === 'string' ? rec.frmtrm_amount : null,
    })
  }
  return out
}

export function deriveFundamentals(rows: readonly DartAccountRow[]): FundamentalsPayload {
  const groups = new Map<string, DartAccountRow[]>()
  for (const row of rows) {
    const key = `${row.bsnsYear}:${row.reprtCode}:${row.rceptNo}`
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }
  const statements = [...groups.entries()].map(([key, bucket]) => {
    const cfs = bucket.filter((row) => row.fsDiv === 'CFS')
    const used = cfs.length ? cfs : bucket.filter((row) => row.fsDiv === 'OFS')
    const sample = used[0] ?? bucket[0]!
    return {
      key,
      rows: used,
      basis: cfs.length ? ('consolidated' as const) : ('separate' as const),
      reprtCode: sample.reprtCode,
      rceptNo: sample.rceptNo,
    }
  })
  statements.sort((a, b) => b.rceptNo.localeCompare(a.rceptNo))

  let revenueYoy: number | null = null
  let operatingMargin: number | null = null
  let debtRatio: number | null = null
  let basis: FundamentalsPayload['basis'] = null
  let newestRceptNo: string | null = null

  for (const statement of statements) {
    const revenue = pickAmount(statement.rows, REVENUE_KEYS, 'thstrmAmount')
    const prior = pickAmount(statement.rows, REVENUE_KEYS, 'frmtrmAmount')
    const op = pickAmount(statement.rows, ['영업이익'], 'thstrmAmount')
    if (revenueYoy == null && revenue != null && prior != null && prior !== 0) {
      revenueYoy = (revenue - prior) / Math.abs(prior)
      basis = statement.basis
      newestRceptNo = statement.rceptNo
    }
    if (operatingMargin == null && op != null && revenue != null && revenue > 0) {
      operatingMargin = op / revenue
      basis = basis ?? statement.basis
      newestRceptNo = newestRceptNo ?? statement.rceptNo
    }
  }
  for (const statement of statements) {
    const liabilities = pickAmount(statement.rows, ['부채총계'], 'thstrmAmount')
    const equity = pickAmount(statement.rows, ['자본총계'], 'thstrmAmount')
    if (liabilities != null && equity != null && equity > 0) {
      debtRatio = liabilities / equity
      basis = basis ?? statement.basis
      newestRceptNo = newestRceptNo ?? statement.rceptNo
      break
    }
  }
  if (!newestRceptNo && statements[0]) newestRceptNo = statements[0].rceptNo

  const annual = statements.find((statement) => statement.reprtCode === '11011')
  const quarterDates: string[] = []
  for (const statement of statements) {
    if (statement.reprtCode === '11011') continue
    const iso = dartYmdToIso(statement.rceptNo)
    if (iso && !quarterDates.includes(iso)) quarterDates.push(iso)
    if (quarterDates.length >= 4) break
  }

  return {
    ok: true,
    newestRceptNo,
    revenueYoy,
    operatingMargin,
    debtRatio,
    basis,
    annualFilingDate: annual ? dartYmdToIso(annual.rceptNo) : null,
    quarterFilingDates: quarterDates,
  }
}

function formatRatio(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return 'none measured'
  return `${(n * 100).toFixed(1)}%`
}

function horizonNote(horizon: string): string | null {
  if (horizon === '1d') return 'Fundamentals rarely move a single session; weigh them lightly for 1d.'
  if (horizon === '1w') return 'Fundamentals matter modestly over 1w; disclosures and flows usually dominate.'
  return null
}

export function formatKrDartPacket(args: {
  horizon: string
  disclosures: DisclosurePayload | 'unavailable'
  fundamentals: FundamentalsPayload | 'unavailable'
}): string {
  const lines = ['Recent disclosures (OpenDART, last 30 days):']
  if (args.disclosures === 'unavailable') {
    lines.push('disclosures unavailable')
  } else if (args.disclosures.items.length === 0) {
    lines.push('none')
    lines.push('BOTH SIDES (disclosures lean up vs down):')
    lines.push('  argues higher close: none')
    lines.push('  argues lower close: none')
  } else {
    const up: string[] = []
    const down: string[] = []
    for (const item of args.disclosures.items) {
      const label = TYPE_LABEL[item.type]
      lines.push(`- ${item.date} ${label} — ${item.title}`)
      const lean = disclosureLean(item.type, item.title)
      const side = `${item.date} ${label}`
      if (lean === 'up') up.push(side)
      if (lean === 'down') down.push(side)
    }
    lines.push('BOTH SIDES (disclosures lean up vs down):')
    lines.push(`  argues higher close: ${up.length ? up.join('; ') : 'none'}`)
    lines.push(`  argues lower close: ${down.length ? down.join('; ') : 'none'}`)
  }

  lines.push('Fundamentals (latest filings):')
  if (args.fundamentals === 'unavailable') {
    lines.push('fundamentals unavailable')
    return lines.join('\n')
  }
  const fund = args.fundamentals
  lines.push(`revenue YoY: ${formatRatio(fund.revenueYoy)}`)
  lines.push(`operating margin: ${formatRatio(fund.operatingMargin)}`)
  lines.push(`debt ratio: ${formatRatio(fund.debtRatio)}`)
  lines.push(`basis: ${fund.basis ?? 'none measured'}`)
  const annual = fund.annualFilingDate ?? 'none measured'
  const quarters = fund.quarterFilingDates.length ? fund.quarterFilingDates.join(', ') : 'none measured'
  lines.push(`filing dates: annual ${annual}; quarters ${quarters}`)
  const note = horizonNote(args.horizon)
  if (note) lines.push(note)
  return lines.join('\n')
}

function decodeXml(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function xmlTag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? decodeXml(m[1]!.trim()) : ''
}

export function parseCorpCodeXml(xml: string): DartCorpListing[] {
  const out: DartCorpListing[] = []
  const re = /<list>([\s\S]*?)<\/list>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(xml))) {
    const block = match[1] ?? ''
    const stockCode = xmlTag(block, 'stock_code').trim()
    const corpCode = xmlTag(block, 'corp_code').trim()
    const corpName = xmlTag(block, 'corp_name').trim()
    const modifyDate = xmlTag(block, 'modify_date').trim()
    if (!/^[0-9A-Z]{6}$/.test(stockCode) || !corpCode || !corpName) continue
    out.push({ stockCode, corpCode, corpName, modifyDate })
  }
  return out
}

export function mapStockCodesToCorps(
  stockCodes: readonly string[],
  corps: readonly DartCorpListing[],
): MappedDartCorp[] {
  const best = new Map<string, DartCorpListing>()
  for (const row of corps) {
    const prev = best.get(row.stockCode)
    if (!prev || row.modifyDate > prev.modifyDate) best.set(row.stockCode, row)
  }
  const seen = new Set<string>()
  const out: MappedDartCorp[] = []
  for (const raw of stockCodes) {
    const code = raw.trim()
    if (!code || seen.has(code)) continue
    seen.add(code)
    const hit = best.get(code)
    if (!hit) continue
    out.push({ stockCode: code, corpCode: hit.corpCode, corpName: hit.corpName })
  }
  return out
}

export function listFilingsFromBody(body: unknown): { reportNm: string; rceptNo: string }[] {
  if (dartStatusKind(body) !== 'ok' || !body || typeof body !== 'object') return []
  const list = (body as { list?: unknown }).list
  if (!Array.isArray(list)) return []
  const out: { reportNm: string; rceptNo: string }[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { report_nm?: unknown; rcept_no?: unknown }
    if (typeof rec.report_nm !== 'string' || typeof rec.rcept_no !== 'string') continue
    out.push({ reportNm: rec.report_nm, rceptNo: rec.rcept_no })
  }
  return out
}
