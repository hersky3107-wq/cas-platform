/**
 * Sale-vs-deposit + date guards for unified ingest.
 *
 * Pure: no I/O, no Date.now(), no "today" fallback. Used by the classifier
 * (prompt post-process) and by createSale / createDeposit so a bad model
 * answer cannot write a bank line as 매출.
 */

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** Hard bank-statement markers — a line with these is never a sale. */
export const BANK_STATEMENT_MARKERS = ['입출금안내', '적요', '잔액', '거래일자'] as const

/** Card-issuer settlement memo: 삼성17938696 / NH15524303 / 하나90343621. */
export const ISSUER_DEPOSIT_MEMO_RE =
  /(?:삼성|신한|하나|국민|농협|롯데|현대|우리|씨티|카카오|비씨|BC|NH|KB)[가-힣A-Za-z]*\s*-?\d{7,}/u

export const SALE_REJECTED_AS_BANK_KO =
  '이 줄은 통장 내역(입출금안내·적요·잔액·거래일자 또는 카드사 입금 메모)으로 보여요. 매출이 아니라 입금입니다. 매출/입금 버튼을 확인해 주세요.'

export const WITHDRAWAL_REJECTED_KO =
  '출금 줄은 매출도 입금도 아닙니다. 저장하지 마세요.'

export const KIND_DISAGREE_KO = '매출인지 입금인지 AI가 갈렸어요. 매출/입금 버튼을 눌러 확인해 주세요.'

/** Confidence cap when the two classifier models disagree on 매출 vs 입금. */
export const KIND_DISAGREE_MAX_CONFIDENCE = 0.4

export function isWithdrawalLine(text: string): boolean {
  // "입출금안내" contains 출금 — strip that compound first.
  const stripped = text.replace(/입출금안내/g, '').replace(/입출금/g, '')
  return stripped.includes('출금')
}

export function hasBankStatementMarkers(text: string): boolean {
  return BANK_STATEMENT_MARKERS.some((m) => text.includes(m))
}

export function looksLikeIssuerDepositMemo(text: string): boolean {
  return ISSUER_DEPOSIT_MEMO_RE.test(text)
}

/** Soft hint used only as a tie-break when models disagree on kind. */
export function looksLikeBankDepositHint(text: string): boolean {
  if (hasBankStatementMarkers(text) || looksLikeIssuerDepositMemo(text)) return true
  const stripped = text.replace(/입출금안내/g, '').replace(/입출금/g, '')
  return stripped.includes('입금')
}

export function cannotSaveAsSale(text: string): boolean {
  return hasBankStatementMarkers(text) || looksLikeIssuerDepositMemo(text)
}

const AMOUNT_TOKEN_RE = /\d{1,3}(?:,\d{3})+|\d{4,}/g

function lineMentionsAmount(line: string, amount: number): boolean {
  const abs = Math.abs(Math.round(amount))
  AMOUNT_TOKEN_RE.lastIndex = 0
  for (const m of line.matchAll(AMOUNT_TOKEN_RE)) {
    if (Number(m[0].replace(/,/g, '')) === abs) return true
  }
  return false
}

/** Only the lines that carry this exact won amount — used for the sale/deposit guard. */
export function sourceLinesForAmount(text: string, amount: number): string {
  if (!text) return ''
  return text
    .split(/\r?\n/)
    .filter((line) => lineMentionsAmount(line, amount))
    .join('\n')
}

/** Amount lines plus one neighbour — used for date recovery (집계일시 on the line above). */
export function sourceContextForAmount(text: string, amount: number): string {
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  const chunks: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!lineMentionsAmount(lines[i]!, amount)) continue
    chunks.push(lines.slice(Math.max(0, i - 1), i + 2).join('\n'))
  }
  return chunks.join('\n')
}

export function saleBlockedBySource(params: {
  snippet: string | null
  documentText: string | null
  amount: number
}): string | null {
  const local = [params.snippet ?? '', sourceLinesForAmount(params.documentText ?? '', params.amount)]
    .filter(Boolean)
    .join('\n')
  if (!local.trim()) return null
  if (isWithdrawalLine(local)) return WITHDRAWAL_REJECTED_KO
  if (cannotSaveAsSale(local)) return SALE_REJECTED_AS_BANK_KO
  return null
}

export function depositBlockedBySource(params: { snippet: string | null; documentText: string | null; amount: number }): string | null {
  const local = [params.snippet ?? '', sourceLinesForAmount(params.documentText ?? '', params.amount)]
    .filter(Boolean)
    .join('\n')
  if (!local.trim()) return null
  if (isWithdrawalLine(local)) return WITHDRAWAL_REJECTED_KO
  return null
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toIsoDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}

export type PrintedDate = { iso: string | null; y: number | null; m: number; d: number }

function overlaps(used: Array<[number, number]>, start: number, end: number): boolean {
  return used.some(([a, b]) => start < b && end > a)
}

/**
 * Dates actually printed in the text. Korean POS uses YY/MM/DD (26/09/05).
 * Never invents a year or falls back to today.
 */
export function parsePrintedDates(text: string): PrintedDate[] {
  const found: PrintedDate[] = []
  const used: Array<[number, number]> = []

  const ymd = /(?<!\d)(20\d{2})[./\-](\d{1,2})[./\-](\d{1,2})(?!\d)/g
  for (const m of text.matchAll(ymd)) {
    if (m.index == null) continue
    const iso = toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]))
    if (!iso) continue
    used.push([m.index, m.index + m[0].length])
    found.push({ iso, y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) })
  }

  // YY/MM/DD — 집계일시 / 집계기간 / per-line POS dates. Must run before M/D.
  const yymd = /(?<!\d)(\d{2})[./](\d{2})[./](\d{2})(?!\d)/g
  for (const m of text.matchAll(yymd)) {
    if (m.index == null || overlaps(used, m.index, m.index + m[0].length)) continue
    const y = 2000 + Number(m[1])
    const iso = toIsoDate(y, Number(m[2]), Number(m[3]))
    if (!iso) continue
    used.push([m.index, m.index + m[0].length])
    found.push({ iso, y, m: Number(m[2]), d: Number(m[3]) })
  }

  const md = /(?<!\d)(\d{1,2})[./\-](\d{1,2})(?!\d)/g
  for (const m of text.matchAll(md)) {
    if (m.index == null || overlaps(used, m.index, m.index + m[0].length)) continue
    const month = Number(m[1])
    const day = Number(m[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    used.push([m.index, m.index + m[0].length])
    found.push({ iso: null, y: null, m: month, d: day })
  }

  return found
}

export function yearFromPrinted(dates: PrintedDate[]): number | null {
  const years = [...new Set(dates.map((d) => d.y).filter((y): y is number => y != null))]
  return years[0] ?? null
}

export function completePrintedDate(printed: PrintedDate, yearHint: number | null): string | null {
  if (printed.iso) return printed.iso
  if (yearHint == null) return null
  return toIsoDate(yearHint, printed.m, printed.d)
}

/**
 * Resolve a classified row's date from what was actually printed.
 * The model's date is only a year hint / confirmation — never a silent
 * substitute for today's date when the print is missing or different.
 */
export function resolveClassifiedDate(opts: {
  modelDate: string | null
  memo: string | null
  sourceText: string
  amount: number
}): { date: string | null; unreadable: boolean } {
  const localBits = [opts.memo ?? '', sourceContextForAmount(opts.sourceText, opts.amount)].join('\n')
  const localPrinted = parsePrintedDates(localBits)
  const globalPrinted = parsePrintedDates(opts.sourceText)
  const modelYear =
    opts.modelDate && DATE_ISO_RE.test(opts.modelDate) ? Number(opts.modelDate.slice(0, 4)) : null
  const yearHint = yearFromPrinted(localPrinted) ?? yearFromPrinted(globalPrinted) ?? modelYear

  const candidates = localPrinted.length > 0 ? localPrinted : globalPrinted
  if (candidates.length === 0) {
    return { date: null, unreadable: true }
  }

  const first = completePrintedDate(candidates[0]!, yearHint)
  if (first) return { date: first, unreadable: false }
  return { date: null, unreadable: true }
}

export function rowLooksLikeWithdrawal(
  memo: string | null,
  amount: number,
  sourceText: string
): boolean {
  if (memo && isWithdrawalLine(memo)) return true
  return sourceText.split(/\r?\n/).some((line) => isWithdrawalLine(line) && lineMentionsAmount(line, amount))
}
