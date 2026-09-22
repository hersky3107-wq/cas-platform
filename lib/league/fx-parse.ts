import { splitCsvLine } from './metals-parse'
import type { CotPositioning } from './closed-book-packet'

/**
 * Pure parsers for FX packet feeds. No fetches — unit tests never import
 * `server-only`. Currency futures live in CFTC TFF (`FinFutWk.txt`) and
 * legacy COT (`deafut.txt`), NOT disaggregated `f_disagg.txt`.
 *
 * TFF Futures-Only layout (0-based):
 *   2 = report date, 3 = CFTC_Contract_Market_Code, 7 = open interest,
 *   14/15 = leveraged-funds long/short (managed-money analog).
 *
 * Legacy COT Futures-Only layout (0-based):
 *   2 = report date, 3 = code, 7 = open interest,
 *   8/9 = non-commercial long/short.
 */

export const CFTC_EUR_CODE = '099741'
export const CFTC_JPY_CODE = '097741'
export const CFTC_GBP_CODE = '096742'
export const CFTC_AUD_CODE = '232741'
export const CFTC_CAD_CODE = '090741'
export const CFTC_CHF_CODE = '092741'
export const CFTC_DXY_CODE = '098662'

export const CFTC_TFF_SOURCE = 'CFTC TFF FinFutWk.txt (leveraged-funds ≈ managed-money analog)'
export const CFTC_LEGACY_SOURCE = 'CFTC legacy COT deafut.txt (non-commercial)'

function num(raw: string | undefined): number | null {
  if (raw == null || raw === '.' || raw === '') return null
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function cotOk(
  contract: string,
  date: string,
  openInterest: number,
  longPos: number,
  shortPos: number,
  source: string,
): Exclude<CotPositioning, { unavailable: string }> {
  return {
    contract,
    date,
    openInterest,
    managedMoneyLong: longPos,
    managedMoneyShort: shortPos,
    managedMoneyNet: longPos - shortPos,
    source,
  }
}

/** Traders in Financial Futures — leveraged-funds long/short. */
export function parseCftcTffLeveragedFunds(
  line: string,
  contractCode: string,
): Exclude<CotPositioning, { unavailable: string }> | null {
  const cols = splitCsvLine(line)
  const code = (cols[3] ?? '').replace(/\s+/g, '')
  if (code !== contractCode) return null
  const date = cols[2] ?? ''
  const openInterest = num(cols[7])
  const levLong = num(cols[14])
  const levShort = num(cols[15])
  if (!date || openInterest == null || levLong == null || levShort == null) return null
  return cotOk(cols[0] || contractCode, date, openInterest, levLong, levShort, CFTC_TFF_SOURCE)
}

/** Legacy COT — non-commercial long/short (fallback when TFF is missing). */
export function parseCftcLegacyNonComm(
  line: string,
  contractCode: string,
): Exclude<CotPositioning, { unavailable: string }> | null {
  const cols = splitCsvLine(line)
  const code = (cols[3] ?? '').replace(/\s+/g, '')
  if (code !== contractCode) return null
  const date = cols[2] ?? ''
  const openInterest = num(cols[7])
  const ncLong = num(cols[8])
  const ncShort = num(cols[9])
  if (!date || openInterest == null || ncLong == null || ncShort == null) return null
  return cotOk(cols[0] || contractCode, date, openInterest, ncLong, ncShort, CFTC_LEGACY_SOURCE)
}

export function cotFromTffText(text: string, contractCode: string): CotPositioning {
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseCftcTffLeveragedFunds(line, contractCode)
    if (parsed) return parsed
  }
  return { unavailable: `CFTC FinFutWk.txt: no TFF row for contract ${contractCode}` }
}

export function cotFromLegacyText(text: string, contractCode: string): CotPositioning {
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseCftcLegacyNonComm(line, contractCode)
    if (parsed) return parsed
  }
  return { unavailable: `CFTC deafut.txt: no legacy row for contract ${contractCode}` }
}
