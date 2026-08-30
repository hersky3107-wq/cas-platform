import 'server-only'

import {
  runSingleAiProvider,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { HITL_CONFIDENCE_THRESHOLD, todayKst } from '@/lib/reconciliation/parser'
import type { SheetCell, SheetGrid } from '@/lib/reconciliation/spreadsheet-read'
import type { PaymentChannel, SaleKind } from '@/lib/reconciliation/types'

/**
 * Format-tolerant spreadsheet mapping.
 *
 * POS exports do not share headers. One AI call maps arbitrary columns onto
 * date/amount (and optional sale_kind / channel hint). Every data row is then
 * extracted deterministically from those columns — no per-row guessing, and
 * unreadable rows are reported rather than dropped.
 */

export const SPREADSHEET_KIND = ['deposits', 'sales'] as const
export type SpreadsheetKind = (typeof SPREADSHEET_KIND)[number]

const SAMPLE_ROWS = 12
const MAX_CELL_CHARS = 80
const TOTALS_RE = /^(합계|총계|소계|누계|total|subtotal|sum|grand total)$/i

export type ColumnMap = {
  headerRowIndex: number | null
  dateCol: number
  amountCol: number
  saleKindCol: number | null
  channelCol: number | null
  confidence: number
  source: 'ai' | 'heuristic'
}

export type FailedSpreadsheetRow = {
  row_index: number
  reason: string
  cells: string[]
}

export type ParsedSpreadsheetRow = {
  row_index: number
  date: string
  amount: number
  confidence: number
  needs_review: boolean
  sale_kind: SaleKind | null
  channel_id: string | null
  sale_kind_defaulted: boolean
}

export type SpreadsheetParseResult = {
  column_map: ColumnMap | null
  rows: ParsedSpreadsheetRow[]
  failed_rows: FailedSpreadsheetRow[]
}

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.replace(/```(?:json)?/gi, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return Math.round(n * 100) / 100
}

function colLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function letterToIndex(letters: string): number | null {
  const s = letters.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(s) || s.length > 3) return null
  let n = 0
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64)
  return n - 1
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n)) return null
  const serial = Math.trunc(n)
  if (serial < 20000 || serial > 80000) return null
  const utc = Date.UTC(1899, 11, 30) + serial * 86400000
  const d = new Date(utc)
  return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function parseFlexibleDate(cell: SheetCell | undefined, today: string): { date: string | null; ambiguous: boolean } {
  if (!cell) return { date: null, ambiguous: false }
  const raw = cell.raw
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { date: validYmd(raw.getFullYear(), raw.getMonth() + 1, raw.getDate()), ambiguous: false }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const asInt = Math.trunc(raw)
    if (asInt >= 19000101 && asInt <= 20991231) {
      const s = String(asInt)
      return { date: validYmd(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8))), ambiguous: false }
    }
    const serial = excelSerialToIso(raw)
    if (serial) return { date: serial, ambiguous: true }
  }

  const text = cell.text.trim()
  if (!text) return { date: null, ambiguous: false }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return { date: validYmd(Number(iso[1]), Number(iso[2]), Number(iso[3])), ambiguous: false }

  const ymd = text.match(/(20\d{2}|19\d{2})[.\-/년](\d{1,2})[.\-/월](\d{1,2})/)
  if (ymd) return { date: validYmd(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])), ambiguous: false }

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return { date: validYmd(Number(compact[1]), Number(compact[2]), Number(compact[3])), ambiguous: false }

  const y2 = text.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/)
  if (y2) {
    const year = 2000 + Number(y2[1])
    return { date: validYmd(year, Number(y2[2]), Number(y2[3])), ambiguous: true }
  }

  const md = text.match(/^(\d{1,2})[.\-/](\d{1,2})$/)
  if (md) {
    const year = Number(today.slice(0, 4))
    return { date: validYmd(year, Number(md[1]), Number(md[2])), ambiguous: true }
  }

  return { date: null, ambiguous: false }
}

export function parseFlexibleAmount(cell: SheetCell | undefined): number | null {
  if (!cell) return null
  const raw = cell.raw
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw < 0 || raw > 1e12) return null
    return Math.round(raw * 100) / 100
  }
  const text = cell.text.trim()
  if (!text) return null
  if (/[()]/.test(text) && /^-/.test(text.replace(/[()]/g, ''))) return null
  const cleaned = text.replace(/[₩원,\s]/gi, '').replace(/krw/gi, '')
  if (!cleaned || /[a-z가-힣]/i.test(cleaned)) return null
  if (cleaned.startsWith('-')) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return null
  return Math.round(n * 100) / 100
}

export function mapSaleKind(text: string | null | undefined): SaleKind | null {
  if (!text) return null
  const t = text.trim().toLowerCase()
  if (!t) return null
  if (/현금|cash/.test(t)) return 'cash'
  if (/상품권|voucher|탐나는전|온누리|지역화폐/.test(t)) return 'app_voucher'
  if (/수기|manual/.test(t)) return 'manual_total'
  if (/카드|card|credit|체크|pg|배달|바코드|알리페이|위챗|텍스프리/.test(t)) return 'card'
  return null
}

function looksLikeTotals(cells: SheetCell[]): boolean {
  return cells.some((c) => TOTALS_RE.test(c.text.trim()))
}

function looksLikeHeaderRow(cells: SheetCell[]): boolean {
  const nonempty = cells.filter((c) => c.text !== '')
  if (nonempty.length === 0) return false
  let numeric = 0
  for (const c of nonempty) {
    if (typeof c.raw === 'number' || parseFlexibleAmount(c) != null) numeric += 1
  }
  return numeric / nonempty.length < 0.5
}

const DATE_HEADER = /날짜|일자|date|일시|거래일|입금일|매출일|판매일|승인일|전표일|영업일/i
const DEPOSIT_AMOUNT_HEADER = /입금|deposit|실입금|이체금액/i
const SALE_AMOUNT_HEADER = /매출|판매금액|판매액|gross|결제금액|승인금액|공급가/i
const GENERIC_AMOUNT_HEADER = /금액|amount|amt/i
const SKIP_AMOUNT_HEADER = /잔액|balance|수수료|fee|부가세|건수|count/i
const KIND_HEADER = /구분|종류|유형|kind|type|결제수단|채널/i
const CHANNEL_HEADER = /채널|channel|수단|카드사|가맹/i

function headerIndex(headers: string[], re: RegExp, skip?: RegExp): number | null {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] ?? ''
    if (skip && skip.test(h)) continue
    if (re.test(h)) return i
  }
  return null
}

function heuristicMap(grid: SheetGrid, kind: SpreadsheetKind): ColumnMap | null {
  if (grid.rows.length === 0) return null
  const headerRowIndex = looksLikeHeaderRow(grid.rows[0]!) ? 0 : null
  const headers =
    headerRowIndex === 0 ? grid.rows[0]!.map((c, i) => c.text || `col${i + 1}`) : grid.rows[0]!.map((_, i) => colLetter(i))

  let dateCol = headerIndex(headers, DATE_HEADER)
  const amountPrefer = kind === 'deposits' ? DEPOSIT_AMOUNT_HEADER : SALE_AMOUNT_HEADER
  let amountCol =
    headerIndex(headers, amountPrefer, SKIP_AMOUNT_HEADER) ??
    headerIndex(headers, GENERIC_AMOUNT_HEADER, SKIP_AMOUNT_HEADER)

  const dataStart = headerRowIndex === 0 ? 1 : 0
  const sample = grid.rows.slice(dataStart, dataStart + SAMPLE_ROWS)
  if (dateCol == null) {
    let best: { col: number; hits: number } | null = null
    const width = Math.max(0, ...grid.rows.map((r) => r.length))
    for (let col = 0; col < width; col++) {
      let hits = 0
      for (const row of sample) {
        if (parseFlexibleDate(row[col], todayKst()).date) hits += 1
      }
      if (hits >= Math.max(1, Math.ceil(sample.length * 0.5)) && (!best || hits > best.hits)) {
        best = { col, hits }
      }
    }
    dateCol = best?.col ?? null
  }
  if (amountCol == null) {
    let best: { col: number; hits: number } | null = null
    const width = Math.max(0, ...grid.rows.map((r) => r.length))
    for (let col = 0; col < width; col++) {
      if (col === dateCol) continue
      let hits = 0
      for (const row of sample) {
        const n = parseFlexibleAmount(row[col])
        if (n != null && n > 0) hits += 1
      }
      if (hits >= Math.max(1, Math.ceil(sample.length * 0.5)) && (!best || hits > best.hits)) {
        best = { col, hits }
      }
    }
    amountCol = best?.col ?? null
  }
  if (dateCol == null || amountCol == null || dateCol === amountCol) return null

  return {
    headerRowIndex,
    dateCol,
    amountCol,
    saleKindCol: kind === 'sales' ? headerIndex(headers, KIND_HEADER) : null,
    channelCol: headerIndex(headers, CHANNEL_HEADER) ?? headerIndex(headers, KIND_HEADER),
    confidence: headerRowIndex === 0 && headerIndex(headers, DATE_HEADER) != null ? 0.75 : 0.55,
    source: 'heuristic',
  }
}

function parseColRef(raw: unknown, colCount: number, headers: string[]): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw >= 0 && raw < colCount) return raw
    if (raw >= 1 && raw <= colCount) return raw - 1
    return null
  }
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.toLowerCase() === 'null') return null
  const letter = letterToIndex(s)
  if (letter != null && letter < colCount) return letter
  const asNum = Number(s)
  if (Number.isInteger(asNum)) {
    if (asNum >= 0 && asNum < colCount) return asNum
    if (asNum >= 1 && asNum <= colCount) return asNum - 1
  }
  const lower = s.toLowerCase()
  const named = headers.findIndex((h) => h.toLowerCase() === lower)
  if (named >= 0) return named
  const includes = headers.findIndex((h) => h && (h.toLowerCase().includes(lower) || lower.includes(h.toLowerCase())))
  if (includes >= 0) return includes
  return null
}

function normalizeSkip(indices: unknown, rowCount: number): Set<number> {
  const raw = Array.isArray(indices) ? indices : []
  const nums = raw.map((v) => Number(v)).filter((n) => Number.isInteger(n))
  const zeroBased = nums.some((n) => n === 0)
  const set = new Set<number>()
  for (const n of nums) {
    const idx = zeroBased ? n : n - 1
    if (idx >= 0 && idx < rowCount) set.add(idx)
  }
  return set
}

function buildSamplePayload(grid: SheetGrid): { headers: string[]; sample: Record<string, unknown>[] } {
  const width = Math.max(0, ...grid.rows.map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => {
    const t = grid.rows[0]?.[i]?.text ?? ''
    return t || colLetter(i)
  })
  const sample = grid.rows.slice(0, SAMPLE_ROWS).map((row, idx) => {
    const obj: Record<string, unknown> = { row_index: idx + 1 }
    for (let i = 0; i < width; i++) {
      const text = (row[i]?.text ?? '').slice(0, MAX_CELL_CHARS)
      obj[colLetter(i)] = text
    }
    return obj
  })
  return { headers, sample }
}

function columnMapFromAi(
  parsed: Record<string, unknown>,
  grid: SheetGrid,
  kind: SpreadsheetKind
): ColumnMap | null {
  const width = Math.max(0, ...grid.rows.map((r) => r.length))
  const headers = grid.rows[0]?.map((c, i) => c.text || colLetter(i)) ?? []
  const dateCol = parseColRef(parsed.date_column ?? parsed.dateCol, width, headers)
  const amountCol = parseColRef(parsed.amount_column ?? parsed.amountCol, width, headers)
  if (dateCol == null || amountCol == null || dateCol === amountCol) return null

  let headerRowIndex: number | null = null
  const hr = parsed.header_row_index ?? parsed.headerRowIndex
  if (typeof hr === 'number' && Number.isInteger(hr)) {
    if (hr === 0) headerRowIndex = 0
    else if (hr === 1) headerRowIndex = 0
    else if (hr >= 0 && hr < grid.rows.length) headerRowIndex = hr
  } else if (looksLikeHeaderRow(grid.rows[0]!)) {
    headerRowIndex = 0
  }

  const saleKindCol =
    kind === 'sales' ? parseColRef(parsed.sale_kind_column ?? parsed.saleKindCol, width, headers) : null
  const channelCol = parseColRef(parsed.channel_column ?? parsed.channel_hint_column ?? parsed.channelCol, width, headers)

  return {
    headerRowIndex,
    dateCol,
    amountCol,
    saleKindCol,
    channelCol,
    confidence: clampConfidence(parsed.confidence ?? 0.7),
    source: 'ai',
  }
}

function mappingSystemPrompt(kind: SpreadsheetKind, today: string, channelNames: string[]): string {
  const extra =
    kind === 'sales'
      ? 'Also map sale_kind_column (card/cash/app_voucher/manual_total) and channel_column if present; otherwise null.'
      : 'This is a DEPOSITS sheet (money that arrived). Prefer an 입금/deposit amount column over 잔액/balance or 매출/sales. sale_kind_column must be null.'
  return [
    'You map spreadsheet columns for a Korean shop POS export or hand-kept ledger.',
    `The user declared this file as ${kind.toUpperCase()}. Do not switch tables.`,
    extra,
    `Today (Asia/Seoul) is ${today}.`,
    channelNames.length
      ? `Known payment channels (match channel_column values to these names when obvious): ${channelNames.join(', ')}.`
      : 'No saved payment channels yet.',
    'Do NOT extract row values. Only identify which columns hold the date and the amount.',
    'Skip total/summary rows via skip_row_indices (1-based).',
    'If the first row is headers, header_row_index is 1.',
    'Respond with ONLY compact JSON:',
    '{"header_row_index":1|null,"date_column":"A"|number,"amount_column":"B"|number,"sale_kind_column":"C"|null,"channel_column":"D"|null,"skip_row_indices":[number],"confidence":<0..1>,"unreadable":<boolean>}',
    'confidence is how sure you are of the column mapping, not of individual cells. If you cannot find both date and amount columns, set unreadable true.',
  ].join(' ')
}

function resolveChannel(text: string | null | undefined, channels: PaymentChannel[]): PaymentChannel | null {
  const n = text?.trim()
  if (!n) return null
  const exact = channels.filter((c) => c.name === n)
  if (exact.length === 1) return exact[0]!
  const lower = channels.filter((c) => c.name.toLowerCase() === n.toLowerCase())
  if (lower.length === 1) return lower[0]!
  return null
}

function applyMap(
  grid: SheetGrid,
  map: ColumnMap,
  kind: SpreadsheetKind,
  skip: Set<number>,
  channels: PaymentChannel[],
  today: string
): { rows: ParsedSpreadsheetRow[]; failed_rows: FailedSpreadsheetRow[] } {
  const rows: ParsedSpreadsheetRow[] = []
  const failed_rows: FailedSpreadsheetRow[] = []

  for (let i = 0; i < grid.rows.length; i++) {
    if (map.headerRowIndex === i) continue
    if (skip.has(i)) {
      failed_rows.push({
        row_index: i + 1,
        reason: 'Row marked as a header/total/skip — not imported, not guessed',
        cells: grid.rows[i]!.map((c) => c.text),
      })
      continue
    }
    const cells = grid.rows[i]!
    if (!cells.some((c) => c.text !== '')) continue

    if (looksLikeTotals(cells)) {
      failed_rows.push({
        row_index: i + 1,
        reason: 'Looks like a totals/summary row — not imported, not guessed',
        cells: cells.map((c) => c.text),
      })
      continue
    }

    const dateParsed = parseFlexibleDate(cells[map.dateCol], today)
    const amount = parseFlexibleAmount(cells[map.amountCol])
    if (!dateParsed.date || amount == null) {
      const missing = [
        !dateParsed.date ? 'date' : null,
        amount == null ? 'amount' : null,
      ]
        .filter(Boolean)
        .join(' and ')
      failed_rows.push({
        row_index: i + 1,
        reason: `Could not read ${missing} from the mapped columns`,
        cells: cells.map((c) => c.text),
      })
      continue
    }

    let saleKind: SaleKind | null = null
    let saleKindDefaulted = false
    if (kind === 'sales') {
      const kindText = map.saleKindCol != null ? cells[map.saleKindCol]?.text ?? '' : ''
      saleKind = mapSaleKind(kindText)
      if (!saleKind) {
        saleKind = 'card'
        saleKindDefaulted = true
      }
    }

    const channelText = map.channelCol != null ? cells[map.channelCol]?.text ?? '' : ''
    const channel = resolveChannel(channelText, channels)

    let confidence = map.confidence
    if (dateParsed.ambiguous) confidence = Math.min(confidence, 0.65)
    if (saleKindDefaulted) confidence = Math.min(confidence, 0.65)
    if (map.source === 'heuristic' && map.confidence < 0.7) confidence = Math.min(confidence, 0.65)
    confidence = clampConfidence(confidence)

    rows.push({
      row_index: i + 1,
      date: dateParsed.date,
      amount,
      confidence,
      needs_review: confidence < HITL_CONFIDENCE_THRESHOLD,
      sale_kind: saleKind,
      channel_id: channel?.id ?? null,
      sale_kind_defaulted: saleKindDefaulted,
    })
  }

  return { rows, failed_rows }
}

export async function parseSpreadsheet(params: {
  userId: string
  grid: SheetGrid
  kind: SpreadsheetKind
  channels: PaymentChannel[]
  supabaseAccessToken?: string | null
  provider?: ExtendedAiProviderName
}): Promise<SpreadsheetParseResult> {
  const today = todayKst()
  const heuristic = heuristicMap(params.grid, params.kind)
  const { headers, sample } = buildSamplePayload(params.grid)
  const userPrompt = JSON.stringify({ columns: headers, sample })

  let aiMap: ColumnMap | null = null
  let skip = new Set<number>()
  try {
    const result = await runSingleAiProvider({
      supabase: supabaseAdmin,
      sessionId: null,
      userId: params.userId,
      provider: params.provider ?? 'openai',
      systemPrompt: mappingSystemPrompt(
        params.kind,
        today,
        params.channels.map((c) => c.name)
      ),
      prompt: userPrompt,
      supabaseAccessToken: params.supabaseAccessToken ?? undefined,
      temperature: 0,
      maxCompletionTokens: 400,
      skipLanguageInjection: true,
    })
    const parsed = result.text ? extractJson(result.text) : null
    if (parsed && parsed.unreadable !== true) {
      aiMap = columnMapFromAi(parsed, params.grid, params.kind)
      skip = normalizeSkip(parsed.skip_row_indices ?? parsed.skipRowIndices, params.grid.rows.length)
    }
  } catch {
    aiMap = null
  }

  const map = aiMap ?? heuristic
  if (!map) {
    return { column_map: null, rows: [], failed_rows: [] }
  }

  const applied = applyMap(params.grid, map, params.kind, skip, params.channels, today)
  return { column_map: map, ...applied }
}
