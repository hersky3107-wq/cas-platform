/**
 * Validation and row shape for per-session ORACLE inputs.
 *
 * These are reading state, not the USER's profile identity. PRISM colours,
 * tarot fan positions, rune cloth picks, and 육효 coin casts can change on
 * every reading, so each session keeps its own copy.
 *
 * The one identity-shaped key is `partner` (궁합 Person B) — and it is here
 * PRECISELY BECAUSE it must never become a profile: it is someone else's
 * birth data, entered for one session, stored only on that session row.
 */
import {
  RUNE_POSITION_BASE,
  RUNE_SPREADS,
  TAROT_POSITION_BASE,
  TAROT_SPREADS,
  type RuneSpreadSize,
  type TarotSpreadSize,
} from '../engines/draw/conventions'
import type { LineValue } from '../engines/draw/tables'
import { PRISM_COLORS, type PrismColor } from '../engines/prism'
import type { MicroCheck } from '../engines/prism/types'

export const ORACLE_TAROT_POSITION_MAX = 78
export const ORACLE_RUNE_COUNT_MAX = 24
export const ORACLE_ICHING_LINE_COUNT = 6
export const ORACLE_ICHING_LINE_VALUES = [6, 7, 8, 9] as const

export type OraclePrismSessionInput = {
  impulse: PrismColor
  need: PrismColor
  identity: PrismColor
  microCheck?: MicroCheck
}

export type OracleTarotSessionInput = {
  spread: TarotSpreadSize
  /** 1-based indexes into the seeded shuffle (the fanned deck). */
  pickedPositions: number[]
}

export type OracleRunesSessionInput =
  | {
      spread: RuneSpreadSize
      /** 1-based indexes into the seeded 24-stone shuffle (the cloth). */
      pickedPositions: number[]
    }
  /** Legacy shape (pre-cloth clients): count only, seeded picks. */
  | { count: number }

export type OracleIchingSessionInput = {
  /** Six user-cast line values, BOTTOM-UP (효1 first), each 6/7/8/9. */
  lines: LineValue[]
}

/**
 * 궁합 Person B — SOMEONE ELSE'S data, so it is session-scoped by design:
 * it lives only on this oracle_job_sessions row and is NEVER written to the
 * user's profile or to oracle_profiles. Birth date is required; time, sex
 * (대운/大限 direction only), and name (성명 궁합 only) degrade honestly.
 */
export type OracleCompatPartnerInput = {
  /** YYYY-MM-DD, a real civil day. */
  birthDate: string
  /** 'HH:mm', or null/absent when unknown. */
  birthTime?: string | null
  /** Used only for 대운/大限 direction; defaulted (and flagged) when absent. */
  sex?: 'M' | 'F' | null
  /** Local (Korean) name; only the 성명 궁합 system needs it. */
  name?: string | null
}

export const ORACLE_COMPAT_PARTNER_NAME_MAX = 40

/**
 * Generic bag by design: future systems may add their own per-session input
 * without another migration. Known keys (prism, tarot, runes, iching) are
 * validated; other top-level keys are preserved unchanged.
 */
export type OracleSessionInputs = {
  prism?: OraclePrismSessionInput
  tarot?: OracleTarotSessionInput
  runes?: OracleRunesSessionInput
  iching?: OracleIchingSessionInput
  /** kind='compat' only. Session-scoped Person B; never a profile row. */
  partner?: OracleCompatPartnerInput
} & Record<string, unknown>

export type SessionInputsValidation =
  | { ok: true; value: OracleSessionInputs | null }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPrismColor(value: unknown): value is PrismColor {
  return typeof value === 'string' && (PRISM_COLORS as readonly string[]).includes(value)
}

function isMicroCheck(value: unknown): value is MicroCheck {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 5)
  )
}

function isSpreadSize(value: unknown): value is TarotSpreadSize {
  return typeof value === 'number' && (TAROT_SPREADS as readonly number[]).includes(value)
}

function parsePrism(raw: unknown): SessionInputsValidation {
  if (raw === undefined) return { ok: true, value: null }
  if (!isRecord(raw)) {
    return { ok: false, error: 'sessionInputs.prism must be an object' }
  }
  const { impulse, need, identity, microCheck } = raw
  if (!isPrismColor(impulse) || !isPrismColor(need) || !isPrismColor(identity)) {
    return {
      ok: false,
      error: `sessionInputs.prism colors must be one of ${PRISM_COLORS.join(', ')}`,
    }
  }
  if (new Set([impulse, need, identity]).size !== 3) {
    return { ok: false, error: 'sessionInputs.prism colors must be distinct' }
  }
  if (microCheck !== undefined && !isMicroCheck(microCheck)) {
    return {
      ok: false,
      error: 'sessionInputs.prism.microCheck must contain exactly four integers from 1 to 5',
    }
  }
  const prism: OraclePrismSessionInput = {
    impulse,
    need,
    identity,
    ...(microCheck === undefined ? {} : { microCheck }),
  }
  return { ok: true, value: { prism } }
}

function parseTarot(raw: unknown): SessionInputsValidation {
  if (raw === undefined) return { ok: true, value: null }
  if (!isRecord(raw)) {
    return { ok: false, error: 'sessionInputs.tarot must be an object' }
  }
  if (!isSpreadSize(raw.spread)) {
    return { ok: false, error: `sessionInputs.tarot.spread must be one of ${TAROT_SPREADS.join(', ')}` }
  }
  const spread = raw.spread
  if (!Array.isArray(raw.pickedPositions)) {
    return { ok: false, error: 'sessionInputs.tarot.pickedPositions must be an array' }
  }
  if (raw.pickedPositions.length !== spread) {
    return {
      ok: false,
      error: `sessionInputs.tarot.pickedPositions must contain exactly ${spread} values`,
    }
  }
  const pickedPositions: number[] = []
  const seen = new Set<number>()
  for (const pos of raw.pickedPositions) {
    if (!Number.isInteger(pos) || pos < TAROT_POSITION_BASE || pos > ORACLE_TAROT_POSITION_MAX) {
      return {
        ok: false,
        error: `sessionInputs.tarot.pickedPositions must be integers ${TAROT_POSITION_BASE}..${ORACLE_TAROT_POSITION_MAX}`,
      }
    }
    if (seen.has(pos)) {
      return { ok: false, error: `sessionInputs.tarot.pickedPositions must be unique (duplicate ${pos})` }
    }
    seen.add(pos)
    pickedPositions.push(pos)
  }
  return { ok: true, value: { tarot: { spread, pickedPositions } } }
}

function isRuneSpread(value: unknown): value is RuneSpreadSize {
  return typeof value === 'number' && (RUNE_SPREADS as readonly number[]).includes(value)
}

function parseRunes(raw: unknown): SessionInputsValidation {
  if (raw === undefined) return { ok: true, value: null }
  if (!isRecord(raw)) {
    return { ok: false, error: 'sessionInputs.runes must be an object' }
  }

  // New shape: the two-step cloth draw (spread + hand-picked stones).
  if ('pickedPositions' in raw || 'spread' in raw) {
    if (!isRuneSpread(raw.spread)) {
      return { ok: false, error: `sessionInputs.runes.spread must be one of ${RUNE_SPREADS.join(', ')}` }
    }
    const spread = raw.spread
    if (!Array.isArray(raw.pickedPositions) || raw.pickedPositions.length !== spread) {
      return {
        ok: false,
        error: `sessionInputs.runes.pickedPositions must contain exactly ${spread} values`,
      }
    }
    const pickedPositions: number[] = []
    const seen = new Set<number>()
    for (const pos of raw.pickedPositions) {
      if (!Number.isInteger(pos) || pos < RUNE_POSITION_BASE || pos > ORACLE_RUNE_COUNT_MAX) {
        return {
          ok: false,
          error: `sessionInputs.runes.pickedPositions must be integers ${RUNE_POSITION_BASE}..${ORACLE_RUNE_COUNT_MAX}`,
        }
      }
      if (seen.has(pos)) {
        return { ok: false, error: `sessionInputs.runes.pickedPositions must be unique (duplicate ${pos})` }
      }
      seen.add(pos)
      pickedPositions.push(pos)
    }
    return { ok: true, value: { runes: { spread, pickedPositions } } }
  }

  // Legacy shape: count only (seeded picks).
  const count = raw.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > ORACLE_RUNE_COUNT_MAX) {
    return {
      ok: false,
      error: `sessionInputs.runes.count must be an integer 1..${ORACLE_RUNE_COUNT_MAX}`,
    }
  }
  return { ok: true, value: { runes: { count } } }
}

function isLineValue(value: unknown): value is LineValue {
  return typeof value === 'number' && (ORACLE_ICHING_LINE_VALUES as readonly number[]).includes(value)
}

function parseIching(raw: unknown): SessionInputsValidation {
  if (raw === undefined) return { ok: true, value: null }
  if (!isRecord(raw)) {
    return { ok: false, error: 'sessionInputs.iching must be an object' }
  }
  if (!Array.isArray(raw.lines) || raw.lines.length !== ORACLE_ICHING_LINE_COUNT) {
    return {
      ok: false,
      error: `sessionInputs.iching.lines must contain exactly ${ORACLE_ICHING_LINE_COUNT} values (bottom-up)`,
    }
  }
  const lines: LineValue[] = []
  for (const value of raw.lines) {
    if (!isLineValue(value)) {
      return {
        ok: false,
        error: `sessionInputs.iching.lines values must be one of ${ORACLE_ICHING_LINE_VALUES.join(', ')} (노음/소양/소음/노양)`,
      }
    }
    lines.push(value)
  }
  return { ok: true, value: { iching: { lines } } }
}

function isRealCivilDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function parsePartner(raw: unknown): SessionInputsValidation {
  if (raw === undefined) return { ok: true, value: null }
  if (!isRecord(raw)) {
    return { ok: false, error: 'sessionInputs.partner must be an object' }
  }

  const { birthDate, birthTime, sex, name } = raw
  if (typeof birthDate !== 'string' || !isRealCivilDay(birthDate.trim())) {
    return { ok: false, error: 'sessionInputs.partner.birthDate must be a real YYYY-MM-DD day' }
  }

  let time: string | null = null
  if (birthTime !== undefined && birthTime !== null) {
    if (typeof birthTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(birthTime.trim())) {
      return { ok: false, error: 'sessionInputs.partner.birthTime must be HH:mm when present' }
    }
    time = birthTime.trim()
  }

  if (sex !== undefined && sex !== null && sex !== 'M' && sex !== 'F') {
    return { ok: false, error: "sessionInputs.partner.sex must be 'M' or 'F' when present" }
  }

  let partnerName: string | null = null
  if (name !== undefined && name !== null) {
    if (typeof name !== 'string') {
      return { ok: false, error: 'sessionInputs.partner.name must be a string when present' }
    }
    const trimmed = name.trim()
    if (trimmed.length > ORACLE_COMPAT_PARTNER_NAME_MAX) {
      return {
        ok: false,
        error: `sessionInputs.partner.name must be at most ${ORACLE_COMPAT_PARTNER_NAME_MAX} characters`,
      }
    }
    partnerName = trimmed.length > 0 ? trimmed : null
  }

  const partner: OracleCompatPartnerInput = {
    birthDate: birthDate.trim(),
    birthTime: time,
    sex: sex === 'M' || sex === 'F' ? sex : null,
    name: partnerName,
  }
  return { ok: true, value: { partner } }
}

/**
 * Validates untrusted request JSON before any credit charge.
 * Missing/null sessionInputs is valid (PRISM becomes a 결번; tarot/runes
 * fall back to the seeded default draw).
 */
export function validateSessionInputs(raw: unknown): SessionInputsValidation {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!isRecord(raw)) {
    return { ok: false, error: 'sessionInputs must be an object when present' }
  }

  const prism = parsePrism(raw.prism)
  if (!prism.ok) return prism
  const tarot = parseTarot(raw.tarot)
  if (!tarot.ok) return tarot
  const runes = parseRunes(raw.runes)
  if (!runes.ok) return runes
  const iching = parseIching(raw.iching)
  if (!iching.ok) return iching
  const partner = parsePartner(raw.partner)
  if (!partner.ok) return partner

  const value: OracleSessionInputs = { ...raw }
  if (prism.value && 'prism' in prism.value) value.prism = prism.value.prism
  else delete value.prism
  if (tarot.value && 'tarot' in tarot.value) value.tarot = tarot.value.tarot
  else delete value.tarot
  if (runes.value && 'runes' in runes.value) value.runes = runes.value.runes
  else delete value.runes
  if (iching.value && 'iching' in iching.value) value.iching = iching.value.iching
  else delete value.iching
  if (partner.value && 'partner' in partner.value) value.partner = partner.value.partner
  else delete value.partner

  return { ok: true, value }
}
