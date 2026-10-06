/**
 * KRSTOCK ranked-round display. Pure — no network, no DB, no market-data.
 */

import { decodeKrStockInstrument } from './korea-equity-catalog'

export type KrStockAnchorSource =
  | 'krx_official'
  | 'krx_data_portal'
  | 'twelvedata'
  | 'krx_official_verified'

export function formatPortalAnchorCorrectionNote(args: {
  stored: number
  official: number
  sessionDate: string
}): string {
  return `잠정 종가 ${args.stored}원이 공식 종가 ${args.official}원으로 정정됨 (${args.sessionDate})`
}

const KRSTOCK_PROP_RE =
  /^Will (.+) \(([0-9A-Z]{6})\) close higher at the KRX regular-session close on (\d{4}-\d{2}-\d{2}) than at its KRX regular-session close on (\d{4}-\d{2}-\d{2})\?$/

export function krStockPropositionEn(args: {
  name: string
  code: string
  resolveDate: string
  anchorDate: string
}): string {
  return `Will ${args.name} (${args.code}) close higher at the KRX regular-session close on ${args.resolveDate} than at its KRX regular-session close on ${args.anchorDate}?`
}

export function krStockPropositionKo(args: {
  name: string
  code: string
  resolveDate: string
  anchorDate: string
}): string {
  return `${args.name}(${args.code})가 ${args.resolveDate} KRX 정규장 종가 기준으로 ${args.anchorDate} KRX 정규장 종가보다 높게 마감할까?`
}

export function parseKrStockProposition(stored: string): {
  name: string
  code: string
  resolveDate: string
  anchorDate: string
} | null {
  const m = stored.trim().match(KRSTOCK_PROP_RE)
  if (!m) return null
  return { name: m[1]!, code: m[2]!, resolveDate: m[3]!, anchorDate: m[4]! }
}

export function krStockPropositionDisplay(instrument: string, stored: string, locale: string): string {
  if (!decodeKrStockInstrument(instrument)) return stored
  if (locale !== 'ko') return stored
  const parsed = parseKrStockProposition(stored)
  if (!parsed) return stored
  return krStockPropositionKo(parsed)
}

/**
 * Bumped when this KRSTOCK extra-query text changes. The research cache key
 * stays `rp_v4|…|eqN` and only gains this suffix, so old rows miss.
 * Count stays 3 — these replace the generic news/earnings/catalyst seeds.
 */
export const KR_STOCK_QUERY_SET_VERSION = 'qs2'

export function krStockAugmentationQueries(
  name: string,
  code: string,
  groupLabel?: string | null,
): { q: string; lang: string }[] {
  const company = name.trim() || code
  const sector = groupLabel?.trim() || '해당 업종'
  return [
    { q: `최근 7일 ${company} 핵심 악재·호재`, lang: 'ko' },
    { q: `${company} 공시·유상증자·전환사채·수주·소송·규제`, lang: 'ko' },
    { q: `${sector} 업황 최근 동향`, lang: 'ko' },
  ]
}

export function krxClosesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}
