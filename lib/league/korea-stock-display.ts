/**
 * KRSTOCK ranked-round display. Pure — no network, no DB, no market-data.
 */

import { decodeKrStockInstrument } from './korea-equity-catalog'

export type KrStockAnchorSource = 'krx_official' | 'twelvedata' | 'krx_official_verified'

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

export function krStockAugmentationQueries(name: string, code: string): { q: string; lang: string }[] {
  const label = `${name}(${code})`
  return [
    { q: `${label} 최근 뉴스와 주가 촉매 (실적, 규제, 매크로, 가이던스)`, lang: 'ko' },
    { q: `${label} 최근 실적발표 톤 가이던스 서프라이즈 컨퍼런스콜`, lang: 'ko' },
    { q: `${label} 예정된 촉매 실적발표일 투자자의 날 신제품 수주`, lang: 'ko' },
  ]
}

export function krxClosesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}
