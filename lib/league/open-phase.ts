/**
 * Market-session phase at round open — tagging only (no generate gating).
 *
 * Phases are relative to the instrument's primary exchange calendar:
 *  - pre_open / intraday / after_close for sessioned markets
 *  - weekend when the exchange is closed for the calendar weekend
 *  - crypto (24/7) is always `intraday`
 *
 * Pure module (no server-only) so vitest can cover it without the market-data
 * import chain.
 */

export type OpenPhase = 'pre_open' | 'intraday' | 'after_close' | 'weekend'

export const OPEN_PHASES: readonly OpenPhase[] = ['pre_open', 'intraday', 'after_close', 'weekend']

export function isOpenPhase(value: unknown): value is OpenPhase {
  return value === 'pre_open' || value === 'intraday' || value === 'after_close' || value === 'weekend'
}

type SessionSpec = {
  timeZone: string
  openMinutes: number
  closeMinutes: number
  closesOnWeekend: boolean
}

const US_EQUITY: SessionSpec = {
  timeZone: 'America/New_York',
  openMinutes: 9 * 60 + 30,
  closeMinutes: 16 * 60,
  closesOnWeekend: true,
}

const KRX_EQUITY: SessionSpec = {
  timeZone: 'Asia/Seoul',
  openMinutes: 9 * 60,
  closeMinutes: 15 * 60 + 30,
  closesOnWeekend: true,
}

const FX_WEEKDAY: SessionSpec = {
  timeZone: 'America/New_York',
  openMinutes: 0,
  closeMinutes: 24 * 60,
  closesOnWeekend: true,
}

/** Mirrors `mapInstrumentToTwelveData` kind/exchange rules without importing server-only. */
function sessionForInstrument(instrument: string): SessionSpec | 'crypto_247' {
  const raw = instrument.trim()
  if (!raw || raw.includes(':')) return US_EQUITY
  if (raw.endsWith('.KS') || raw.endsWith('.KQ')) return KRX_EQUITY
  if (raw.includes('/')) {
    const [base, quote] = raw.split('/')
    const fiat = new Set(['USD', 'EUR', 'JPY', 'KRW', 'GBP', 'CNY', 'AUD', 'CAD', 'CHF', 'HKD'])
    if (fiat.has(base?.toUpperCase() ?? '') && fiat.has(quote?.toUpperCase() ?? '')) return FX_WEEKDAY
    return 'crypto_247'
  }
  if (raw.includes('-')) return 'crypto_247'
  return US_EQUITY
}

function localParts(at: Date, timeZone: string): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = fmt.formatToParts(at)
  const weekdayName = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return { weekday: weekdayMap[weekdayName] ?? 0, minutes: hour * 60 + minute }
}

export function resolveOpenPhase(instrument: string, at: Date = new Date()): OpenPhase {
  const session = sessionForInstrument(instrument)
  if (session === 'crypto_247') return 'intraday'

  const { weekday, minutes } = localParts(at, session.timeZone)
  if (session.closesOnWeekend && (weekday === 0 || weekday === 6)) return 'weekend'
  if (minutes < session.openMinutes) return 'pre_open'
  if (minutes >= session.closeMinutes) return 'after_close'
  return 'intraday'
}
