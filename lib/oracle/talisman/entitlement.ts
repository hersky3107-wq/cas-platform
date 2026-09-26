/**
 * 부적 download gate. Preview SVG is free; PNG is not.
 *
 * First deficiency phone is free once per user lifetime — only on that
 * user's earliest finished integrated session (created_at). Never writes a
 * row. Any purchase unlocks all four formats for that (session, purpose).
 */
import { TALISMAN_PRICE } from '../runner/conventions'
import type { TalismanPngFormat } from './png/formats'
import type { TalismanPurpose } from './types'

export const TALISMAN_BUY_PURPOSES = [
  'deficiency',
  'wealth',
  'love',
  'promotion',
  'health',
  'exorcism',
] as const

export type TalismanBuyPurpose = (typeof TALISMAN_BUY_PURPOSES)[number]

export const TALISMAN_PURPOSE_LABELS: Record<TalismanBuyPurpose, string> = {
  deficiency: '결핍 부적',
  wealth: '재물',
  love: '연애',
  promotion: '승진합격',
  health: '건강',
  exorcism: '파마',
}

export function parseTalismanBuyPurpose(raw: string | null | undefined): TalismanBuyPurpose {
  if (!raw || raw === 'deficiency') return 'deficiency'
  return (TALISMAN_BUY_PURPOSES as readonly string[]).includes(raw)
    ? (raw as TalismanBuyPurpose)
    : 'deficiency'
}

export function talismanComputePurpose(purpose: TalismanBuyPurpose): TalismanPurpose | null {
  return purpose === 'deficiency' ? null : purpose
}

export function talismanPriceFor(purpose: TalismanBuyPurpose): number {
  return purpose === 'deficiency' ? TALISMAN_PRICE.deficiency : TALISMAN_PRICE.purpose
}

export function isFirstIntegratedSession(
  sessionId: string,
  firstSessionId: string | null | undefined,
): boolean {
  return Boolean(firstSessionId) && sessionId === firstSessionId
}

/** Computed grant. Never writes talisman_purchases — a deficiency row means paid. */
export function isFreePhoneGrant(input: {
  purpose: TalismanBuyPurpose
  format: TalismanPngFormat
  isFirstIntegratedSession: boolean
}): boolean {
  return input.isFirstIntegratedSession && input.purpose === 'deficiency' && input.format === 'phone'
}

export function canDownloadTalismanFormat(input: {
  purchased: boolean
  purpose: TalismanBuyPurpose
  format: TalismanPngFormat
  isFirstIntegratedSession: boolean
}): boolean {
  if (input.purchased) return true
  return isFreePhoneGrant(input)
}

export function unlockedTalismanFormats(input: {
  purchased: boolean
  purpose: TalismanBuyPurpose
  isFirstIntegratedSession: boolean
}): TalismanPngFormat[] {
  const formats: TalismanPngFormat[] = ['phone', 'wallet', 'square', 'desktop']
  return formats.filter((format) => canDownloadTalismanFormat({ ...input, format }))
}

export type TalismanGateKind = 'no-reading' | 'free-phone' | 'unpaid' | 'paid'

export function talismanDownloadGate(input: {
  hasReading: boolean
  purchased: boolean
  purpose: TalismanBuyPurpose
  format: TalismanPngFormat
  isFirstIntegratedSession: boolean
}): TalismanGateKind {
  if (!input.hasReading) return 'no-reading'
  if (input.purchased) return 'paid'
  if (isFreePhoneGrant(input)) return 'free-phone'
  return 'unpaid'
}
